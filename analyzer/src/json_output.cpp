#include "json_output.h"
#include "ast_consumer.h"
#include "logger.h"

namespace codesage {

json functionToJson(const FunctionInfo& func) {
    CS_DEBUG("functionToJson: {}", func.name());
    json j;
    j["usr"] = func.usr();
    j["name"] = func.name();
    j["file"] = func.file();
    j["line"] = func.line();
    j["column"] = func.column();
    j["module"] = func.module();
    j["signature"] = func.signature();

    if (func.modifies_size() > 0) {
        j["modifies"] = json::array();
        for (const auto& m : func.modifies()) {
            j["modifies"].push_back(m);
        }
    }
    if (func.references_size() > 0) {
        j["references"] = json::array();
        for (const auto& r : func.references()) {
            j["references"].push_back(r);
        }
    }

    return j;
}

json callEdgeToJson(const CallEdge& edge) {
    json j;
    j["caller_usr"] = edge.caller_usr();
    j["callee_usr"] = edge.callee_usr();
    j["call_file"] = edge.call_file();
    j["call_line"] = edge.call_line();
    j["call_column"] = edge.call_column();
    if (!edge.edge_type().empty()) {
        j["edge_type"] = edge.edge_type();
    }
    return j;
}

json globalVarToJson(const GlobalVarInfo& var) {
    CS_DEBUG("globalVarToJson: {}", var.name());
    json j;
    j["usr"] = var.usr();
    j["name"] = var.name();
    j["file"] = var.file();
    j["line"] = var.line();
    j["type"] = var.type();
    j["is_extern"] = var.is_extern();
    j["module"] = var.module();
    return j;
}

json accessToJson(const GlobalVarAccess& access) {
    json j;
    j["var_usr"] = access.var_usr();
    j["function_usr"] = access.function_usr();
    j["is_write"] = access.is_write();
    j["access_file"] = access.access_file();
    j["access_line"] = access.access_line();
    j["access_column"] = access.access_column();
    return j;
}

json dataFlowEdgeToJson(const DataFlowEdge& edge) {
    json j;
    j["from_usr"] = edge.from_usr();
    j["to_usr"] = edge.to_usr();
    j["var_usr"] = edge.var_usr();
    j["type"] = edge.type();
    return j;
}

json callGraphResponseToJson(const CallGraphResponse& response) {
    CS_DEBUG("callGraphResponseToJson: {} nodes, {} edges",
             response.nodes_size(), response.edges_size());
    json j;
    j["nodes"] = json::array();
    j["edges"] = json::array();

    for (const auto& node : response.nodes()) {
        j["nodes"].push_back(functionToJson(node));
    }
    for (const auto& edge : response.edges()) {
        j["edges"].push_back(callEdgeToJson(edge));
    }

    return j;
}

json dataFlowResponseToJson(const DataFlowResponse& response) {
    CS_DEBUG("dataFlowResponseToJson: {} func nodes, {} var nodes, {} edges",
             response.function_nodes_size(), response.variable_nodes_size(),
             response.edges_size());
    json j;
    j["function_nodes"] = json::array();
    j["variable_nodes"] = json::array();
    j["edges"] = json::array();

    for (const auto& node : response.function_nodes()) {
        j["function_nodes"].push_back(functionToJson(node));
    }
    for (const auto& node : response.variable_nodes()) {
        j["variable_nodes"].push_back(globalVarToJson(node));
    }
    for (const auto& edge : response.edges()) {
        j["edges"].push_back(dataFlowEdgeToJson(edge));
    }

    return j;
}

json searchResultToJson(const std::vector<FunctionInfo>& funcs) {
    json j = json::array();
    for (const auto& func : funcs) {
        j.push_back(functionToJson(func));
    }
    return j;
}

json variableSearchResultToJson(const std::vector<GlobalVarInfo>& vars) {
    json j = json::array();
    for (const auto& var : vars) {
        j.push_back(globalVarToJson(var));
    }
    return j;
}

json accessListToJson(const std::vector<GlobalVarAccess>& accesses) {
    json j = json::array();
    for (const auto& access : accesses) {
        j.push_back(accessToJson(access));
    }
    return j;
}

json statsToJson(const AnalyzerStats& stats) {
    json j;
    j["files_processed"] = stats.files_processed;
    j["functions_collected"] = stats.functions_collected;
    j["edges_collected"] = stats.edges_collected;
    j["variables_collected"] = stats.variables_collected;
    j["accesses_collected"] = stats.accesses_collected;
    j["elapsed_seconds"] = stats.elapsed_seconds;
    return j;
}

}  // namespace codesage
