#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <unordered_set>

#include "generated/codesage.pb.h"

namespace codesage {

class Storage;

struct SideEffectSummary {
    std::unordered_set<std::string> modifies;   // variable USRs this function may write
    std::unordered_set<std::string> references;  // variable USRs this function may read
};

class DataFlowAnalyzer {
public:
    explicit DataFlowAnalyzer(Storage& storage);

    // Run fixed-point propagation to compute side-effect summaries for all functions
    void computeSideEffects();

    // Persist computed summaries back to storage (updates FunctionInfo.modifies/references)
    void persistSummaries();

    // Query: find all functions that directly or indirectly modify a variable
    std::vector<std::string> findModifiers(const std::string& var_usr);

    // Query: find all functions that directly or indirectly reference a variable
    std::vector<std::string> findReaders(const std::string& var_usr);

    // Query: build data flow subgraph centered on a variable
    DataFlowResponse buildVariableDataFlow(const std::string& var_usr, int depth = 3);

    // Query: find data flow path between two functions for a specific variable
    std::vector<std::string> findDataFlowPath(
        const std::string& from_func_usr,
        const std::string& to_func_usr,
        const std::string& var_usr);

    // Post-processing: resolve cross-function callback edges
    size_t resolveCallbackEdges();

    const std::unordered_map<std::string, SideEffectSummary>& getSummaries() const {
        return summaries_;
    }

private:
    // Load direct accesses from storage
    void loadDirectAccesses();

    // Load call graph edges from storage
    void loadCallGraph();

    Storage& storage_;

    // func_usr -> side effect summary
    std::unordered_map<std::string, SideEffectSummary> summaries_;

    // Call graph: caller -> set of callees
    std::unordered_map<std::string, std::unordered_set<std::string>> forward_edges_;

    // Reverse call graph: callee -> set of callers
    std::unordered_map<std::string, std::unordered_set<std::string>> backward_edges_;

    // Variable -> set of functions that directly access it
    std::unordered_map<std::string, std::unordered_set<std::string>> var_accessors_;

    bool computed_ = false;
};

}  // namespace codesage
