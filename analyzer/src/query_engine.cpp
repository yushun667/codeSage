#include "query_engine.h"
#include "storage.h"
#include "dataflow_analyzer.h"
#include "logger.h"

#include <queue>
#include <algorithm>

namespace codesage {

// ============== LRUCache ==============

LRUCache::LRUCache(size_t capacity) : capacity_(capacity) {
    CS_DEBUG("LRUCache initialized with capacity {}", capacity);
}

void LRUCache::put(const std::string& key, const FunctionInfo& value) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto it = map_.find(key);
    if (it != map_.end()) {
        items_.erase(it->second);
        map_.erase(it);
    }

    items_.push_front({key, value});
    map_[key] = items_.begin();

    while (items_.size() > capacity_) {
        auto last = items_.end();
        --last;
        map_.erase(last->first);
        items_.pop_back();
    }
}

std::optional<FunctionInfo> LRUCache::get(const std::string& key) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto it = map_.find(key);
    if (it == map_.end()) return std::nullopt;

    items_.splice(items_.begin(), items_, it->second);
    return it->second->second;
}

void LRUCache::invalidate(const std::string& key) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = map_.find(key);
    if (it != map_.end()) {
        items_.erase(it->second);
        map_.erase(it);
    }
}

void LRUCache::clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    items_.clear();
    map_.clear();
}

size_t LRUCache::size() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return items_.size();
}

// ============== QueryEngine ==============

QueryEngine::QueryEngine(Storage& storage, size_t cache_size)
    : storage_(storage), cache_(cache_size) {
    CS_INFO("QueryEngine initialized, cache_size={}", cache_size);
}

std::vector<FunctionInfo> QueryEngine::searchFunctions(const std::string& query, int limit) {
    CS_INFO("searchFunctions: query='{}', limit={}", query, limit);
    return storage_.searchFunctions(query, limit);
}

std::optional<FunctionInfo> QueryEngine::getFunctionInfo(const std::string& usr) {
    CS_DEBUG("getFunctionInfo: {}", usr);

    auto cached = cache_.get(usr);
    if (cached) return cached;

    auto func = storage_.getFunction(usr);
    if (func) {
        cache_.put(usr, *func);
    }
    return func;
}

FunctionInfo QueryEngine::getOrLoadFunction(const std::string& usr) {
    auto func = getFunctionInfo(usr);
    if (func) return *func;

    FunctionInfo empty;
    empty.set_usr(usr);
    empty.set_name("(unknown)");
    return empty;
}

void QueryEngine::collectForward(const std::string& usr, int depth,
                                  std::unordered_set<std::string>& visited_nodes,
                                  std::vector<CallEdge>& collected_edges) {
    if (depth <= 0) return;
    if (!visited_nodes.insert(usr).second) return;

    auto edges = storage_.getForwardEdges(usr);
    for (const auto& edge : edges) {
        collected_edges.push_back(edge);
        collectForward(edge.callee_usr(), depth - 1, visited_nodes, collected_edges);
    }
}

void QueryEngine::collectBackward(const std::string& usr, int depth,
                                   std::unordered_set<std::string>& visited_nodes,
                                   std::vector<CallEdge>& collected_edges) {
    if (depth <= 0) return;
    if (!visited_nodes.insert(usr).second) return;

    auto edges = storage_.getBackwardEdges(usr);
    for (const auto& edge : edges) {
        collected_edges.push_back(edge);
        collectBackward(edge.caller_usr(), depth - 1, visited_nodes, collected_edges);
    }
}

CallGraphResponse QueryEngine::getForwardCallGraph(const std::string& root_usr, int depth) {
    CS_INFO("getForwardCallGraph: root={}, depth={}", root_usr, depth);

    CallGraphResponse response;
    std::unordered_set<std::string> visited_nodes;
    std::vector<CallEdge> collected_edges;

    visited_nodes.insert(root_usr);
    collectForward(root_usr, depth, visited_nodes, collected_edges);

    for (const auto& usr : visited_nodes) {
        auto func = getOrLoadFunction(usr);
        *response.add_nodes() = func;
    }

    for (const auto& edge : collected_edges) {
        *response.add_edges() = edge;
    }

    CS_INFO("getForwardCallGraph: {} nodes, {} edges",
            response.nodes_size(), response.edges_size());
    return response;
}

CallGraphResponse QueryEngine::getBackwardCallGraph(const std::string& root_usr, int depth) {
    CS_INFO("getBackwardCallGraph: root={}, depth={}", root_usr, depth);

    CallGraphResponse response;
    std::unordered_set<std::string> visited_nodes;
    std::vector<CallEdge> collected_edges;

    visited_nodes.insert(root_usr);
    collectBackward(root_usr, depth, visited_nodes, collected_edges);

    for (const auto& usr : visited_nodes) {
        auto func = getOrLoadFunction(usr);
        *response.add_nodes() = func;
    }

    for (const auto& edge : collected_edges) {
        *response.add_edges() = edge;
    }

    CS_INFO("getBackwardCallGraph: {} nodes, {} edges",
            response.nodes_size(), response.edges_size());
    return response;
}

CallGraphResponse QueryEngine::findPath(const std::string& from_usr, const std::string& to_usr) {
    CS_INFO("findPath: from={}, to={}", from_usr, to_usr);

    CallGraphResponse response;

    // BFS to find shortest path
    std::queue<std::vector<std::string>> paths;
    std::unordered_set<std::string> visited;

    paths.push({from_usr});
    visited.insert(from_usr);

    std::vector<std::string> found_path;
    const size_t max_depth = 15;

    while (!paths.empty()) {
        auto path = paths.front();
        paths.pop();

        if (path.size() > max_depth) continue;

        const auto& current = path.back();
        if (current == to_usr) {
            found_path = path;
            break;
        }

        auto edges = storage_.getForwardEdges(current);
        for (const auto& edge : edges) {
            if (visited.count(edge.callee_usr())) continue;
            visited.insert(edge.callee_usr());

            auto new_path = path;
            new_path.push_back(edge.callee_usr());
            paths.push(std::move(new_path));
        }
    }

    if (found_path.empty()) {
        CS_INFO("findPath: no path found");
        return response;
    }

    // Build response with path nodes and edges
    std::unordered_set<std::string> path_set(found_path.begin(), found_path.end());
    for (const auto& usr : found_path) {
        *response.add_nodes() = getOrLoadFunction(usr);
    }

    for (size_t i = 0; i + 1 < found_path.size(); i++) {
        auto edges = storage_.getForwardEdges(found_path[i]);
        for (const auto& edge : edges) {
            if (edge.callee_usr() == found_path[i + 1]) {
                *response.add_edges() = edge;
                break;
            }
        }
    }

    CS_INFO("findPath: found path with {} nodes", found_path.size());
    return response;
}

std::vector<GlobalVarInfo> QueryEngine::searchVariables(const std::string& query, int limit) {
    CS_INFO("searchVariables: query='{}', limit={}", query, limit);
    return storage_.searchVariables(query, limit);
}

std::optional<GlobalVarInfo> QueryEngine::getVariableInfo(const std::string& usr) {
    CS_DEBUG("getVariableInfo: {}", usr);
    return storage_.getGlobalVar(usr);
}

std::vector<GlobalVarAccess> QueryEngine::getVariableAccesses(
    const std::string& var_usr, const std::string& func_filter) {
    CS_DEBUG("getVariableAccesses: var={}, func_filter={}", var_usr, func_filter);

    auto accesses = storage_.getAccessesByVariable(var_usr);

    if (!func_filter.empty()) {
        accesses.erase(
            std::remove_if(accesses.begin(), accesses.end(),
                           [&](const GlobalVarAccess& a) {
                               return a.function_usr() != func_filter;
                           }),
            accesses.end());
    }

    return accesses;
}

DataFlowResponse QueryEngine::getVariableDataFlow(const std::string& var_usr, int depth) {
    CS_INFO("getVariableDataFlow: var={}, depth={}", var_usr, depth);

    if (!dataflow_) {
        dataflow_ = std::make_unique<DataFlowAnalyzer>(storage_);
        dataflow_->computeSideEffects();
    }

    return dataflow_->buildVariableDataFlow(var_usr, depth);
}

size_t QueryEngine::getCacheSize() const {
    return cache_.size();
}

}  // namespace codesage
