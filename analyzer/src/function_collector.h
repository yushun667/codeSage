#pragma once

#include <string>
#include <vector>
#include <unordered_set>

#include <clang/ASTMatchers/ASTMatchFinder.h>
#include <clang/AST/Decl.h>

#include "generated/codesage.pb.h"

namespace codesage {

class Storage;

// Determines which module a file belongs to based on configured module paths
std::string resolveModule(const std::string& filepath,
                          const std::string& project_root,
                          const std::vector<std::string>& module_paths);

class FunctionDefCallback : public clang::ast_matchers::MatchFinder::MatchCallback {
public:
    FunctionDefCallback(Storage& storage,
                        const std::string& project_root,
                        const std::vector<std::string>& module_paths);

    void run(const clang::ast_matchers::MatchFinder::MatchResult& result) override;

    size_t getCollectedCount() const { return collected_count_; }

private:
    std::string getUSR(const clang::Decl* decl);
    std::string getSignature(const clang::FunctionDecl* fd);

    Storage& storage_;
    std::string project_root_;
    std::vector<std::string> module_paths_;
    std::unordered_set<std::string> seen_usrs_;
    size_t collected_count_ = 0;
};

class CallExprCallback : public clang::ast_matchers::MatchFinder::MatchCallback {
public:
    CallExprCallback(Storage& storage, const std::string& project_root = "");

    void run(const clang::ast_matchers::MatchFinder::MatchResult& result) override;

    size_t getCollectedCount() const { return collected_count_; }
    size_t getSkippedCount() const { return skipped_count_; }

private:
    std::string getUSR(const clang::Decl* decl);

    template <typename ExprT>
    bool findCallerAndStore(clang::ASTContext& ctx, clang::SourceManager& sm,
                            const ExprT& expr,
                            const clang::FunctionDecl* callee_decl,
                            clang::SourceLocation call_loc);

    bool shouldSkipLocation(clang::SourceManager& sm, clang::SourceLocation loc) const;

    Storage& storage_;
    std::string project_root_;
    std::unordered_set<std::string> seen_edges_;
    size_t collected_count_ = 0;
    size_t skipped_count_ = 0;
};

}  // namespace codesage
