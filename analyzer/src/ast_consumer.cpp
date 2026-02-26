#include "ast_consumer.h"
#include "storage.h"
#include "function_collector.h"
#include "variable_collector.h"
#include "logger.h"

#include <chrono>
#include <algorithm>
#include <thread>
#include <mutex>
#include <atomic>

#include <clang/ASTMatchers/ASTMatchers.h>
#include <clang/ASTMatchers/ASTMatchFinder.h>
#include <clang/Frontend/FrontendActions.h>
#include <clang/Tooling/CommonOptionsParser.h>
#include <clang/Tooling/Tooling.h>
#include <clang/Tooling/CompilationDatabase.h>
#include <clang/Tooling/JSONCompilationDatabase.h>

using namespace clang;
using namespace clang::ast_matchers;
using namespace clang::tooling;

namespace codesage {

// Custom compilation database wrapper that adjusts compile commands
class AdjustedCompilationDatabase : public CompilationDatabase {
public:
    AdjustedCompilationDatabase(std::unique_ptr<CompilationDatabase> inner,
                                 bool replace_system_includes)
        : inner_(std::move(inner)), replace_system_(replace_system_includes) {
        CS_DEBUG("AdjustedCompilationDatabase: replace_system={}", replace_system_);
    }

    std::vector<CompileCommand> getCompileCommands(llvm::StringRef file) const override {
        auto cmds = inner_->getCompileCommands(file);
        if (replace_system_) {
            for (auto& cmd : cmds) {
                adjustCommand(cmd);
            }
        }
        return cmds;
    }

    std::vector<std::string> getAllFiles() const override {
        return inner_->getAllFiles();
    }

    std::vector<CompileCommand> getAllCompileCommands() const override {
        auto cmds = inner_->getAllCompileCommands();
        if (replace_system_) {
            for (auto& cmd : cmds) {
                adjustCommand(cmd);
            }
        }
        return cmds;
    }

private:
    void adjustCommand(CompileCommand& cmd) const {
        for (size_t i = 0; i < cmd.CommandLine.size(); ++i) {
            auto& arg = cmd.CommandLine[i];
            // Replace -I with --isystem for non-project includes
            if (arg == "-I" && i + 1 < cmd.CommandLine.size()) {
                const auto& path = cmd.CommandLine[i + 1];
                // Keep project-root includes as -I, convert others to --isystem
                if (path.find(cmd.Directory) == std::string::npos) {
                    arg = "-isystem";
                }
            } else if (arg.substr(0, 2) == "-I" && arg.size() > 2) {
                std::string path = arg.substr(2);
                if (path.find(cmd.Directory) == std::string::npos) {
                    arg = "-isystem" + path;
                }
            }
        }
    }

    std::unique_ptr<CompilationDatabase> inner_;
    bool replace_system_;
};

// ============== SourceAnalyzer ==============

SourceAnalyzer::SourceAnalyzer(Storage& storage, const AnalyzerConfig& config)
    : storage_(storage), config_(config) {
    CS_INFO("SourceAnalyzer initialized: project_root={}, modules={}",
            config_.project_root, config_.core_modules.size());
}

AnalyzerStats SourceAnalyzer::parseAll() {
    CS_INFO("Starting full parse from compile_db: {}", config_.compile_db_path);

    auto start = std::chrono::steady_clock::now();

    std::string err;
    auto cdb = JSONCompilationDatabase::loadFromFile(
        config_.compile_db_path, err,
        JSONCommandLineSyntax::AutoDetect);

    if (!cdb) {
        CS_ERROR("Failed to load compilation database: {}", err);
        return {};
    }

    auto all_files = cdb->getAllFiles();
    CS_INFO("Compilation database contains {} files", all_files.size());

    // Filter already parsed files
    std::vector<std::string> unparsed;
    for (const auto& f : all_files) {
        if (!storage_.isFileParsed(f)) {
            unparsed.push_back(f);
        }
    }
    CS_INFO("{} files need parsing ({} already parsed)", unparsed.size(), all_files.size() - unparsed.size());

    if (unparsed.empty()) {
        CS_INFO("All files already parsed, nothing to do");
        return {};
    }

    auto adjusted_cdb = std::make_unique<AdjustedCompilationDatabase>(
        std::move(cdb), config_.replace_system_includes);

    auto stats = this->parseFilesWithDB(*adjusted_cdb, unparsed);

    auto end = std::chrono::steady_clock::now();
    stats.elapsed_seconds = std::chrono::duration<double>(end - start).count();
    CS_INFO("Parse complete: {} files, {} functions, {} edges, {} vars, {} accesses in {:.1f}s",
            stats.files_processed, stats.functions_collected, stats.edges_collected,
            stats.variables_collected, stats.accesses_collected, stats.elapsed_seconds);

    return stats;
}

AnalyzerStats SourceAnalyzer::parseFiles(const std::vector<std::string>& files) {
    CS_INFO("Parsing {} specified files", files.size());

    std::string err;
    auto cdb = JSONCompilationDatabase::loadFromFile(
        config_.compile_db_path, err,
        JSONCommandLineSyntax::AutoDetect);

    if (!cdb) {
        CS_ERROR("Failed to load compilation database: {}", err);
        return {};
    }

    auto adjusted_cdb = std::make_unique<AdjustedCompilationDatabase>(
        std::move(cdb), config_.replace_system_includes);

    return this->parseFilesWithDB(*adjusted_cdb, files);
}

AnalyzerStats SourceAnalyzer::parseModule(const std::string& module_path) {
    CS_INFO("Parsing module: {}", module_path);

    std::string err;
    auto cdb = JSONCompilationDatabase::loadFromFile(
        config_.compile_db_path, err,
        JSONCommandLineSyntax::AutoDetect);

    if (!cdb) {
        CS_ERROR("Failed to load compilation database: {}", err);
        return {};
    }

    auto module_files = getModuleFiles(*cdb, module_path);
    CS_INFO("Module '{}' contains {} files", module_path, module_files.size());

    // Filter already parsed
    std::vector<std::string> unparsed;
    for (const auto& f : module_files) {
        if (!storage_.isFileParsed(f)) {
            unparsed.push_back(f);
        }
    }

    if (unparsed.empty()) {
        CS_INFO("Module '{}' already fully parsed", module_path);
        return {};
    }

    auto adjusted_cdb = std::make_unique<AdjustedCompilationDatabase>(
        std::move(cdb), config_.replace_system_includes);

    return this->parseFilesWithDB(*adjusted_cdb, unparsed);
}

AnalyzerStats SourceAnalyzer::parseFilesWithDB(
    CompilationDatabase& cdb, const std::vector<std::string>& files) {

    const int jobs = std::max(1, config_.parallel_jobs);
    const size_t total = files.size();

    // Emit total count to stderr so the backend can detect it
    std::cerr << total << " files need parsing" << std::endl;

    std::atomic<size_t> files_done{0};
    std::mutex progress_mutex;

    if (jobs <= 1 || total <= 1) {
        CS_INFO("Single-threaded parse: {} files", total);
        return parseBatchWithProgress(cdb, files, total, files_done, progress_mutex);
    }

    CS_INFO("Parallel parse: {} files with {} jobs", total, jobs);

    std::vector<std::vector<std::string>> batches(jobs);
    for (size_t i = 0; i < total; ++i) {
        batches[i % jobs].push_back(files[i]);
    }

    std::vector<AnalyzerStats> batch_stats(jobs);
    std::vector<std::thread> threads;

    for (int i = 0; i < jobs; ++i) {
        if (batches[i].empty()) continue;
        threads.emplace_back([&, i]() {
            CS_INFO("Worker {} starting: {} files", i, batches[i].size());
            batch_stats[i] = parseBatchWithProgress(
                cdb, batches[i], total, files_done, progress_mutex);
            CS_INFO("Worker {} done: {} funcs, {} edges",
                    i, batch_stats[i].functions_collected, batch_stats[i].edges_collected);
        });
    }

    for (auto& t : threads) t.join();

    AnalyzerStats stats;
    for (const auto& s : batch_stats) {
        stats.files_processed += s.files_processed;
        stats.functions_collected += s.functions_collected;
        stats.edges_collected += s.edges_collected;
        stats.variables_collected += s.variables_collected;
        stats.accesses_collected += s.accesses_collected;
    }

    return stats;
}

AnalyzerStats SourceAnalyzer::parseBatchWithProgress(
    CompilationDatabase& cdb, const std::vector<std::string>& files,
    size_t total_files, std::atomic<size_t>& files_done,
    std::mutex& progress_mutex) {

    AnalyzerStats stats;

    FunctionDefCallback func_cb(storage_, config_.project_root, config_.core_modules);
    CallExprCallback call_cb(storage_);
    GlobalVarDeclCallback var_cb(storage_, config_.project_root, config_.core_modules);
    VarRefCallback ref_cb(storage_);

    MatchFinder finder;
    finder.addMatcher(functionDecl(isDefinition()).bind("func"), &func_cb);
    finder.addMatcher(
        callExpr(callee(functionDecl().bind("callee"))).bind("call"),
        &call_cb);
    finder.addMatcher(varDecl(hasGlobalStorage()).bind("globalVar"), &var_cb);
    finder.addMatcher(
        declRefExpr(to(varDecl(hasGlobalStorage()).bind("refVar"))).bind("varRef"),
        &ref_cb);

    auto factory = newFrontendActionFactory(&finder);

    for (const auto& file : files) {
        ClangTool tool(cdb, {file});
        tool.setDiagnosticConsumer(new clang::IgnoringDiagConsumer());
        int result = tool.run(factory.get());

        if (result != 0) {
            CS_WARN("ClangTool returned non-zero for {}: {}", file, result);
        }

        storage_.markFileParsed(file);
        auto done = files_done.fetch_add(1) + 1;

        {
            std::lock_guard<std::mutex> lock(progress_mutex);
            std::cerr << "[" << done << "/" << total_files
                      << "] Processed file " << file << "." << std::endl;
        }
    }

    stats.files_processed = files.size();
    stats.functions_collected = func_cb.getCollectedCount();
    stats.edges_collected = call_cb.getCollectedCount();
    stats.variables_collected = var_cb.getCollectedCount();
    stats.accesses_collected = ref_cb.getCollectedCount();

    return stats;
}

std::vector<std::string> SourceAnalyzer::getModuleFiles(
    const CompilationDatabase& cdb, const std::string& module_path) {

    std::vector<std::string> module_files;
    auto all_files = cdb.getAllFiles();

    std::string target = config_.project_root;
    if (!target.empty() && target.back() != '/') target += '/';
    target += module_path;

    for (const auto& f : all_files) {
        if (f.find(target) == 0 || f.find(module_path) != std::string::npos) {
            module_files.push_back(f);
        }
    }

    return module_files;
}

std::vector<CompileCommand> SourceAnalyzer::adjustCommands(
    const std::vector<CompileCommand>& cmds) {
    // Handled by AdjustedCompilationDatabase
    return cmds;
}

}  // namespace codesage
