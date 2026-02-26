#pragma once

#include <string>
#include <unordered_set>

#include <clang/ASTMatchers/ASTMatchFinder.h>
#include <clang/AST/Decl.h>

#include "generated/codesage.pb.h"

namespace codesage {

class Storage;

class GlobalVarDeclCallback : public clang::ast_matchers::MatchFinder::MatchCallback {
public:
    GlobalVarDeclCallback(Storage& storage,
                          const std::string& project_root,
                          const std::vector<std::string>& module_paths);

    void run(const clang::ast_matchers::MatchFinder::MatchResult& result) override;

    size_t getCollectedCount() const { return collected_count_; }

private:
    std::string getUSR(const clang::Decl* decl);

    Storage& storage_;
    std::string project_root_;
    std::vector<std::string> module_paths_;
    std::unordered_set<std::string> seen_usrs_;
    size_t collected_count_ = 0;
};

class VarRefCallback : public clang::ast_matchers::MatchFinder::MatchCallback {
public:
    VarRefCallback(Storage& storage);

    void run(const clang::ast_matchers::MatchFinder::MatchResult& result) override;

    size_t getCollectedCount() const { return collected_count_; }

private:
    std::string getUSR(const clang::Decl* decl);
    bool isWriteAccess(const clang::DeclRefExpr* ref,
                       const clang::ast_matchers::MatchFinder::MatchResult& result);

    Storage& storage_;
    std::unordered_set<std::string> seen_accesses_;
    size_t collected_count_ = 0;
};

}  // namespace codesage
