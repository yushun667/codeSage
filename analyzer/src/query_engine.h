#pragma once

#include <string>
#include <vector>
#include <unordered_set>
#include <unordered_map>
#include <list>
#include <mutex>

#include "generated/codesage.pb.h"

namespace codesage {

class Storage;
class DataFlowAnalyzer;

// LRU cache for function nodes
class LRUCache {
public:
    explicit LRUCache(size_t capacity = 5000);

    void put(const std::string& key, const FunctionInfo& value);
    std::optional<FunctionInfo> get(const std::string& key);
    void invalidate(const std::string& key);
    void clear();
    size_t size() const;

private:
    size_t capacity_;
    std::list<std::pair<std::string, FunctionInfo>> items_;
    std::unordered_map<std::string, decltype(items_)::iterator> map_;
    mutable std::mutex mutex_;
};

class QueryEngine {
public:
    QueryEngine(Storage& storage, size_t cache_size = 5000);
    ~QueryEngine();

    // Function search
    std::vector<FunctionInfo> searchFunctions(const std::string& query, int limit = 50);
    std::optional<FunctionInfo> getFunctionInfo(const std::string& usr);

    // Call graph queries
    CallGraphResponse getForwardCallGraph(const std::string& root_usr, int depth = 2);
    CallGraphResponse getBackwardCallGraph(const std::string& root_usr, int depth = 2);
    CallGraphResponse findPath(const std::string& from_usr, const std::string& to_usr);

    // Variable queries
    std::vector<GlobalVarInfo> searchVariables(const std::string& query, int limit = 50);
    std::optional<GlobalVarInfo> getVariableInfo(const std::string& usr);
    std::vector<GlobalVarAccess> getVariableAccesses(const std::string& var_usr,
                                                      const std::string& func_filter = "");

    // Data flow queries (delegates to DataFlowAnalyzer)
    DataFlowResponse getVariableDataFlow(const std::string& var_usr, int depth = 3);

    // Stats
    size_t getCacheSize() const;

private:
    FunctionInfo getOrLoadFunction(const std::string& usr);

    void collectForward(const std::string& usr, int depth,
                        std::unordered_set<std::string>& visited_nodes,
                        std::vector<CallEdge>& collected_edges);

    void collectBackward(const std::string& usr, int depth,
                         std::unordered_set<std::string>& visited_nodes,
                         std::vector<CallEdge>& collected_edges);

    Storage& storage_;
    LRUCache cache_;
    std::unique_ptr<DataFlowAnalyzer> dataflow_;
};

}  // namespace codesage
