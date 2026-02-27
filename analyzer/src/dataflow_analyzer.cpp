#include "dataflow_analyzer.h"
#include "storage.h"
#include "logger.h"

#include <queue>
#include <algorithm>

namespace codesage {

DataFlowAnalyzer::DataFlowAnalyzer(Storage& storage)
    : storage_(storage) {
    CS_INFO("DataFlowAnalyzer initialized");
}

void DataFlowAnalyzer::loadDirectAccesses() {
    CS_INFO("Loading direct variable accesses from storage...");
    size_t count = 0;

    storage_.iterateWithPrefix("access:", [&](const std::string& key, const std::string& value) -> bool {
        // Skip reverse index keys
        if (key.find("access_var:") == 0) return true;

        GlobalVarAccess access;
        if (!access.ParseFromString(value)) return true;

        auto& summary = summaries_[access.function_usr()];
        if (access.is_write()) {
            summary.modifies.insert(access.var_usr());
        } else {
            summary.references.insert(access.var_usr());
        }

        var_accessors_[access.var_usr()].insert(access.function_usr());
        count++;
        return true;
    });

    CS_INFO("Loaded {} direct accesses for {} functions",
            count, summaries_.size());
}

void DataFlowAnalyzer::loadCallGraph() {
    CS_INFO("Loading call graph from storage...");
    size_t count = 0;

    storage_.iterateWithPrefix("edge:fwd:", [&](const std::string&, const std::string& value) -> bool {
        CallEdge edge;
        if (!edge.ParseFromString(value)) return true;

        forward_edges_[edge.caller_usr()].insert(edge.callee_usr());
        backward_edges_[edge.callee_usr()].insert(edge.caller_usr());
        count++;
        return true;
    });

    CS_INFO("Loaded {} call edges", count);
}

void DataFlowAnalyzer::computeSideEffects() {
    CS_INFO("Computing side-effect summaries (fixed-point iteration)...");

    loadDirectAccesses();
    loadCallGraph();

    // Ensure all functions in the call graph have a summary entry
    for (const auto& [caller, callees] : forward_edges_) {
        summaries_[caller]; // default construct if absent
        for (const auto& callee : callees) {
            summaries_[callee];
        }
    }

    // Work-list algorithm
    std::queue<std::string> worklist;
    std::unordered_set<std::string> in_worklist;

    for (const auto& [func_usr, _] : summaries_) {
        worklist.push(func_usr);
        in_worklist.insert(func_usr);
    }

    size_t iterations = 0;
    size_t max_iterations = summaries_.size() * 10; // safety limit

    while (!worklist.empty() && iterations < max_iterations) {
        std::string func = worklist.front();
        worklist.pop();
        in_worklist.erase(func);

        auto& summary = summaries_[func];
        bool changed = false;

        // Propagate from callees
        auto it = forward_edges_.find(func);
        if (it != forward_edges_.end()) {
            for (const auto& callee : it->second) {
                auto callee_it = summaries_.find(callee);
                if (callee_it == summaries_.end()) continue;

                const auto& callee_summary = callee_it->second;

                for (const auto& var : callee_summary.modifies) {
                    if (summary.modifies.insert(var).second) {
                        changed = true;
                    }
                }
                for (const auto& var : callee_summary.references) {
                    if (summary.references.insert(var).second) {
                        changed = true;
                    }
                }
            }
        }

        // If changed, add all callers back to worklist
        if (changed) {
            auto bwd_it = backward_edges_.find(func);
            if (bwd_it != backward_edges_.end()) {
                for (const auto& caller : bwd_it->second) {
                    if (in_worklist.find(caller) == in_worklist.end()) {
                        worklist.push(caller);
                        in_worklist.insert(caller);
                    }
                }
            }
        }

        iterations++;
    }

    computed_ = true;
    CS_INFO("Fixed-point reached after {} iterations, {} function summaries computed",
            iterations, summaries_.size());
}

void DataFlowAnalyzer::persistSummaries() {
    CS_INFO("Persisting side-effect summaries to storage...");

    if (!computed_) {
        CS_WARN("Side effects not computed yet, call computeSideEffects() first");
        return;
    }

    size_t count = 0;
    for (const auto& [func_usr, summary] : summaries_) {
        auto func = storage_.getFunction(func_usr);
        if (!func) continue;

        func->clear_modifies();
        func->clear_references();

        for (const auto& var : summary.modifies) {
            func->add_modifies(var);
        }
        for (const auto& var : summary.references) {
            func->add_references(var);
        }

        storage_.putFunction(*func);
        count++;
    }

    CS_INFO("Persisted summaries for {} functions", count);
}

std::vector<std::string> DataFlowAnalyzer::findModifiers(const std::string& var_usr) {
    CS_DEBUG("findModifiers: var={}", var_usr);
    std::vector<std::string> result;

    if (!computed_) computeSideEffects();

    for (const auto& [func_usr, summary] : summaries_) {
        if (summary.modifies.count(var_usr)) {
            result.push_back(func_usr);
        }
    }

    CS_DEBUG("findModifiers: found {} modifiers for {}", result.size(), var_usr);
    return result;
}

std::vector<std::string> DataFlowAnalyzer::findReaders(const std::string& var_usr) {
    CS_DEBUG("findReaders: var={}", var_usr);
    std::vector<std::string> result;

    if (!computed_) computeSideEffects();

    for (const auto& [func_usr, summary] : summaries_) {
        if (summary.references.count(var_usr)) {
            result.push_back(func_usr);
        }
    }

    CS_DEBUG("findReaders: found {} readers for {}", result.size(), var_usr);
    return result;
}

DataFlowResponse DataFlowAnalyzer::buildVariableDataFlow(
    const std::string& var_usr, int depth) {
    CS_INFO("buildVariableDataFlow: var={}, depth={}", var_usr, depth);

    if (!computed_) computeSideEffects();

    DataFlowResponse response;

    auto var_info = storage_.getGlobalVar(var_usr);
    if (var_info) {
        *response.add_variable_nodes() = *var_info;
    }

    // Find direct accessors
    std::unordered_set<std::string> relevant_funcs;
    auto accessors_it = var_accessors_.find(var_usr);
    if (accessors_it != var_accessors_.end()) {
        for (const auto& func_usr : accessors_it->second) {
            relevant_funcs.insert(func_usr);
        }
    }

    // BFS expand along call graph up to depth
    std::unordered_set<std::string> frontier = relevant_funcs;
    for (int d = 0; d < depth && !frontier.empty(); d++) {
        std::unordered_set<std::string> next_frontier;
        for (const auto& func : frontier) {
            // Add callers (backward)
            auto bwd_it = backward_edges_.find(func);
            if (bwd_it != backward_edges_.end()) {
                for (const auto& caller : bwd_it->second) {
                    auto& caller_summary = summaries_[caller];
                    if (caller_summary.modifies.count(var_usr) ||
                        caller_summary.references.count(var_usr)) {
                        if (relevant_funcs.insert(caller).second) {
                            next_frontier.insert(caller);
                        }
                    }
                }
            }
            // Add callees (forward)
            auto fwd_it = forward_edges_.find(func);
            if (fwd_it != forward_edges_.end()) {
                for (const auto& callee : fwd_it->second) {
                    auto& callee_summary = summaries_[callee];
                    if (callee_summary.modifies.count(var_usr) ||
                        callee_summary.references.count(var_usr)) {
                        if (relevant_funcs.insert(callee).second) {
                            next_frontier.insert(callee);
                        }
                    }
                }
            }
        }
        frontier = next_frontier;
    }

    // Build response
    for (const auto& func_usr : relevant_funcs) {
        auto func = storage_.getFunction(func_usr);
        if (func) {
            *response.add_function_nodes() = *func;
        }

        // Direct access edges
        auto acc_it = var_accessors_.find(var_usr);
        if (acc_it != var_accessors_.end() && acc_it->second.count(func_usr)) {
            auto& summary = summaries_[func_usr];
            DataFlowEdge edge;
            if (summary.modifies.count(var_usr)) {
                edge.set_from_usr(func_usr);
                edge.set_to_usr(var_usr);
                edge.set_var_usr(var_usr);
                edge.set_type("direct_write");
                *response.add_edges() = edge;
            }
            if (summary.references.count(var_usr)) {
                edge.set_from_usr(var_usr);
                edge.set_to_usr(func_usr);
                edge.set_var_usr(var_usr);
                edge.set_type("direct_read");
                *response.add_edges() = edge;
            }
        }

        // Call edges between relevant functions
        auto fwd_it = forward_edges_.find(func_usr);
        if (fwd_it != forward_edges_.end()) {
            for (const auto& callee : fwd_it->second) {
                if (relevant_funcs.count(callee)) {
                    DataFlowEdge edge;
                    edge.set_from_usr(func_usr);
                    edge.set_to_usr(callee);
                    edge.set_var_usr(var_usr);
                    edge.set_type("call");
                    *response.add_edges() = edge;
                }
            }
        }
    }

    CS_INFO("buildVariableDataFlow: {} function nodes, {} variable nodes, {} edges",
            response.function_nodes_size(), response.variable_nodes_size(),
            response.edges_size());

    return response;
}

std::vector<std::string> DataFlowAnalyzer::findDataFlowPath(
    const std::string& from_func_usr,
    const std::string& to_func_usr,
    const std::string& var_usr) {
    CS_INFO("findDataFlowPath: from={}, to={}, var={}", from_func_usr, to_func_usr, var_usr);

    if (!computed_) computeSideEffects();

    // BFS from source to target along call edges, constrained to functions that
    // modify or reference the given variable
    std::queue<std::vector<std::string>> paths;
    std::unordered_set<std::string> visited;

    paths.push({from_func_usr});
    visited.insert(from_func_usr);

    while (!paths.empty()) {
        auto path = paths.front();
        paths.pop();

        const auto& current = path.back();
        if (current == to_func_usr) {
            CS_INFO("findDataFlowPath: found path of length {}", path.size());
            return path;
        }

        if (path.size() > 20) continue; // depth limit

        auto fwd_it = forward_edges_.find(current);
        if (fwd_it == forward_edges_.end()) continue;

        for (const auto& next : fwd_it->second) {
            if (visited.count(next)) continue;

            auto& summary = summaries_[next];
            if (!summary.modifies.count(var_usr) && !summary.references.count(var_usr)) {
                continue;
            }

            visited.insert(next);
            auto new_path = path;
            new_path.push_back(next);
            paths.push(std::move(new_path));
        }
    }

    CS_INFO("findDataFlowPath: no path found");
    return {};
}

size_t DataFlowAnalyzer::resolveCallbackEdges() {
    CS_INFO("Resolving cross-function callback edges...");

    auto all_passes = storage_.getAllCallbackPasses();
    CS_INFO("Loaded {} callback pass records", all_passes.size());

    if (all_passes.empty()) return 0;

    // For each callee that receives a callback parameter, check if it has
    // indirect calls through that parameter. If so, create a "callback" edge
    // from the callee to the actual callback function.
    //
    // Pattern: A calls B(foo) where foo is a function pointer
    //   => B internally calls param[i] => we create edge B -> foo (type="callback")

    // Group passes by callee_usr
    std::unordered_map<std::string, std::vector<const CallbackPass*>> passes_by_callee;
    for (const auto& pass : all_passes) {
        passes_by_callee[pass.callee_usr()].push_back(&pass);
    }

    // Load forward edges if not already loaded
    if (forward_edges_.empty()) loadCallGraph();

    size_t resolved = 0;

    for (const auto& [callee_usr, passes] : passes_by_callee) {
        // Get existing forward edges from this callee to see if it has
        // unresolved indirect calls (no target) or param-based calls
        auto edges = storage_.getForwardEdges(callee_usr);

        for (const auto* pass : passes) {
            // Create a callback edge: callee_usr -> callback_usr
            CallEdge edge;
            edge.set_caller_usr(pass->callee_usr());
            edge.set_callee_usr(pass->callback_usr());
            edge.set_edge_type("callback");
            edge.set_call_file(pass->call_file());
            edge.set_call_line(pass->call_line());

            // Check for duplicate
            bool dup = false;
            for (const auto& e : edges) {
                if (e.callee_usr() == pass->callback_usr()) {
                    dup = true;
                    break;
                }
            }
            if (dup) continue;

            storage_.putCallEdge(edge);
            resolved++;
            CS_DEBUG("Resolved callback edge: {} -> {} (via param {} from {})",
                     pass->callee_usr(), pass->callback_usr(),
                     pass->param_index(), pass->caller_usr());
        }
    }

    CS_INFO("Resolved {} callback edges", resolved);
    return resolved;
}

}  // namespace codesage
