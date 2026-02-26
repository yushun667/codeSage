#pragma once

#include <string>
#include <vector>

#include <nlohmann/json.hpp>
#include "generated/codesage.pb.h"

namespace codesage {

using json = nlohmann::json;

json functionToJson(const FunctionInfo& func);
json callEdgeToJson(const CallEdge& edge);
json globalVarToJson(const GlobalVarInfo& var);
json accessToJson(const GlobalVarAccess& access);
json dataFlowEdgeToJson(const DataFlowEdge& edge);

json callGraphResponseToJson(const CallGraphResponse& response);
json dataFlowResponseToJson(const DataFlowResponse& response);

json searchResultToJson(const std::vector<FunctionInfo>& funcs);
json variableSearchResultToJson(const std::vector<GlobalVarInfo>& vars);
json accessListToJson(const std::vector<GlobalVarAccess>& accesses);

struct AnalyzerStats;
json statsToJson(const AnalyzerStats& stats);

}  // namespace codesage
