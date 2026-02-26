#pragma once

#include <string>
#include <vector>
#include <memory>

#include <clang/Tooling/Tooling.h>
#include <clang/Tooling/CompilationDatabase.h>

namespace codesage {

class Storage;

struct AnalyzerConfig {
    std::string compile_db_path;
    std::string db_path;
    std::string project_root;
    std::vector<std::string> core_modules;
    bool replace_system_includes = false;
    int parallel_jobs = 1;
};

struct AnalyzerStats {
    size_t files_processed = 0;
    size_t functions_collected = 0;
    size_t edges_collected = 0;
    size_t variables_collected = 0;
    size_t accesses_collected = 0;
    double elapsed_seconds = 0.0;
};

class SourceAnalyzer {
public:
    explicit SourceAnalyzer(Storage& storage, const AnalyzerConfig& config);

    // Parse all source files listed in the compilation database
    AnalyzerStats parseAll();

    // Parse only specified files
    AnalyzerStats parseFiles(const std::vector<std::string>& files);

    // Parse files belonging to a specific module
    AnalyzerStats parseModule(const std::string& module_path);

private:
    // Adjust compile commands per config (e.g., -I → --isystem)
    std::vector<clang::tooling::CompileCommand>
    adjustCommands(const std::vector<clang::tooling::CompileCommand>& cmds);

    // Collect source files for specified modules from the compile database
    std::vector<std::string> getModuleFiles(
        const clang::tooling::CompilationDatabase& cdb,
        const std::string& module_path);

    // Run ClangTool on given files using the provided compilation database
    AnalyzerStats parseFilesWithDB(clang::tooling::CompilationDatabase& cdb,
                                    const std::vector<std::string>& files);

    Storage& storage_;
    AnalyzerConfig config_;
};

}  // namespace codesage
