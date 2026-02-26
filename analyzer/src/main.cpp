#include <iostream>
#include <string>
#include <vector>
#include <sstream>
#include <algorithm>

#include "logger.h"
#include "storage.h"
#include "ast_consumer.h"
#include "query_engine.h"
#include "dataflow_analyzer.h"
#include "json_output.h"

using namespace codesage;

void printUsage(const char* prog) {
    std::cerr << "CodeSage — Function Call Chain & Global Variable Data Flow Analyzer\n\n"
              << "Usage:\n"
              << "  " << prog << " parse [options]\n"
              << "  " << prog << " query <subcommand> [options]\n"
              << "  " << prog << " stats --db=<path>\n\n"
              << "Parse options:\n"
              << "  --compile-db=<path>    Path to compile_commands.json (required)\n"
              << "  --db=<path>            Path to RocksDB database (required)\n"
              << "  --project-root=<path>  Project root directory\n"
              << "  --modules=<m1,m2,...>   Core module paths (comma-separated)\n"
              << "  --system-replace       Replace -I with --isystem for external headers\n"
              << "  --log-dir=<path>       Log output directory\n\n"
              << "Query subcommands:\n"
              << "  search-functions    --db=<path> --query=<name> [--limit=50]\n"
              << "  function-info       --db=<path> --usr=<usr>\n"
              << "  callgraph-forward   --db=<path> --usr=<usr> [--depth=2]\n"
              << "  callgraph-backward  --db=<path> --usr=<usr> [--depth=2]\n"
              << "  path                --db=<path> --from=<usr> --to=<usr>\n"
              << "  search-variables    --db=<path> --query=<name> [--limit=50]\n"
              << "  variable-info       --db=<path> --usr=<usr>\n"
              << "  variable-accesses   --db=<path> --var-usr=<usr> [--func-usr=<usr>]\n"
              << "  dataflow            --db=<path> --var-usr=<usr> [--depth=3]\n";
}

std::string getArg(const std::vector<std::string>& args, const std::string& prefix,
                    const std::string& default_val = "") {
    for (const auto& arg : args) {
        if (arg.find(prefix) == 0) {
            return arg.substr(prefix.size());
        }
    }
    return default_val;
}

bool hasFlag(const std::vector<std::string>& args, const std::string& flag) {
    return std::find(args.begin(), args.end(), flag) != args.end();
}

std::vector<std::string> splitComma(const std::string& s) {
    std::vector<std::string> result;
    std::stringstream ss(s);
    std::string item;
    while (std::getline(ss, item, ',')) {
        if (!item.empty()) result.push_back(item);
    }
    return result;
}

int cmdParse(const std::vector<std::string>& args) {
    std::string compile_db = getArg(args, "--compile-db=");
    std::string db_path = getArg(args, "--db=");
    std::string project_root = getArg(args, "--project-root=", ".");
    std::string modules_str = getArg(args, "--modules=");
    bool system_replace = hasFlag(args, "--system-replace");

    if (compile_db.empty() || db_path.empty()) {
        CS_ERROR("--compile-db and --db are required for parse command");
        std::cerr << "Error: --compile-db and --db are required\n";
        return 1;
    }

    CS_INFO("Parse command: compile_db={}, db={}, project_root={}, system_replace={}",
            compile_db, db_path, project_root, system_replace);

    Storage storage;
    if (!storage.open(db_path)) {
        CS_ERROR("Failed to open database at {}", db_path);
        return 1;
    }

    AnalyzerConfig config;
    config.compile_db_path = compile_db;
    config.db_path = db_path;
    config.project_root = project_root;
    config.core_modules = splitComma(modules_str);
    config.replace_system_includes = system_replace;

    SourceAnalyzer analyzer(storage, config);
    auto stats = analyzer.parseAll();

    // Run dataflow analysis
    CS_INFO("Running dataflow analysis...");
    DataFlowAnalyzer dataflow(storage);
    dataflow.computeSideEffects();
    dataflow.persistSummaries();

    json output = statsToJson(stats);
    output["total_functions"] = storage.countFunctions();
    output["total_edges"] = storage.countEdges();
    output["total_variables"] = storage.countVariables();

    std::cout << output.dump(2) << std::endl;

    storage.close();
    CS_INFO("Parse command completed");
    return 0;
}

int cmdQuery(const std::vector<std::string>& args) {
    if (args.size() < 2) {
        std::cerr << "Error: query subcommand required\n";
        return 1;
    }

    std::string subcmd = args[1];
    std::string db_path = getArg(args, "--db=");

    if (db_path.empty()) {
        CS_ERROR("--db is required for query command");
        std::cerr << "Error: --db is required\n";
        return 1;
    }

    CS_INFO("Query command: subcmd={}, db={}", subcmd, db_path);

    Storage storage;
    if (!storage.open(db_path)) {
        CS_ERROR("Failed to open database at {}", db_path);
        return 1;
    }

    QueryEngine engine(storage);
    json output;

    if (subcmd == "search-functions") {
        std::string query = getArg(args, "--query=");
        int limit = std::stoi(getArg(args, "--limit=", "50"));
        auto results = engine.searchFunctions(query, limit);
        output = searchResultToJson(results);

    } else if (subcmd == "function-info") {
        std::string usr = getArg(args, "--usr=");
        auto func = engine.getFunctionInfo(usr);
        if (func) {
            output = functionToJson(*func);
            auto fwd = storage.getForwardEdges(usr);
            auto bwd = storage.getBackwardEdges(usr);
            output["callees"] = json::array();
            output["callers"] = json::array();
            for (const auto& e : fwd) output["callees"].push_back(callEdgeToJson(e));
            for (const auto& e : bwd) output["callers"].push_back(callEdgeToJson(e));
        } else {
            output = {{"error", "Function not found"}, {"usr", usr}};
        }

    } else if (subcmd == "callgraph-forward") {
        std::string usr = getArg(args, "--usr=");
        int depth = std::stoi(getArg(args, "--depth=", "2"));
        auto response = engine.getForwardCallGraph(usr, depth);
        output = callGraphResponseToJson(response);

    } else if (subcmd == "callgraph-backward") {
        std::string usr = getArg(args, "--usr=");
        int depth = std::stoi(getArg(args, "--depth=", "2"));
        auto response = engine.getBackwardCallGraph(usr, depth);
        output = callGraphResponseToJson(response);

    } else if (subcmd == "path") {
        std::string from = getArg(args, "--from=");
        std::string to = getArg(args, "--to=");
        auto response = engine.findPath(from, to);
        output = callGraphResponseToJson(response);

    } else if (subcmd == "search-variables") {
        std::string query = getArg(args, "--query=");
        int limit = std::stoi(getArg(args, "--limit=", "50"));
        auto results = engine.searchVariables(query, limit);
        output = variableSearchResultToJson(results);

    } else if (subcmd == "variable-info") {
        std::string usr = getArg(args, "--usr=");
        auto var = engine.getVariableInfo(usr);
        if (var) {
            output = globalVarToJson(*var);
        } else {
            output = {{"error", "Variable not found"}, {"usr", usr}};
        }

    } else if (subcmd == "variable-accesses") {
        std::string var_usr = getArg(args, "--var-usr=");
        std::string func_usr = getArg(args, "--func-usr=");
        auto accesses = engine.getVariableAccesses(var_usr, func_usr);
        output = accessListToJson(accesses);

    } else if (subcmd == "dataflow") {
        std::string var_usr = getArg(args, "--var-usr=");
        int depth = std::stoi(getArg(args, "--depth=", "3"));
        auto response = engine.getVariableDataFlow(var_usr, depth);
        output = dataFlowResponseToJson(response);

    } else {
        std::cerr << "Unknown query subcommand: " << subcmd << "\n";
        return 1;
    }

    std::cout << output.dump(2) << std::endl;

    storage.close();
    return 0;
}

int cmdStats(const std::vector<std::string>& args) {
    std::string db_path = getArg(args, "--db=");
    if (db_path.empty()) {
        std::cerr << "Error: --db is required\n";
        return 1;
    }

    Storage storage;
    if (!storage.open(db_path)) return 1;

    json output;
    output["functions"] = storage.countFunctions();
    output["edges"] = storage.countEdges();
    output["variables"] = storage.countVariables();
    output["parsed_files"] = storage.getParsedFiles().size();

    std::cout << output.dump(2) << std::endl;

    storage.close();
    return 0;
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        printUsage(argv[0]);
        return 1;
    }

    std::vector<std::string> args(argv + 1, argv + argc);
    std::string log_dir = getArg(args, "--log-dir=");

    Logger::init(log_dir, spdlog::level::debug);
    CS_INFO("CodeSage Analyzer started, command: {}", args[0]);

    int result = 0;

    if (args[0] == "parse") {
        result = cmdParse(args);
    } else if (args[0] == "query") {
        result = cmdQuery(args);
    } else if (args[0] == "stats") {
        result = cmdStats(args);
    } else if (args[0] == "--help" || args[0] == "-h") {
        printUsage(argv[0]);
    } else {
        std::cerr << "Unknown command: " << args[0] << "\n";
        printUsage(argv[0]);
        result = 1;
    }

    Logger::shutdown();
    return result;
}
