#include "function_collector.h"
#include "storage.h"
#include "logger.h"

#include <clang/AST/ASTContext.h>
#include <clang/AST/DeclBase.h>
#include <clang/Basic/SourceManager.h>
#include <clang/Index/USRGeneration.h>
#include <llvm/ADT/SmallString.h>

using namespace clang;
using namespace clang::ast_matchers;

namespace codesage {

std::string resolveModule(const std::string& filepath,
                          const std::string& project_root,
                          const std::vector<std::string>& module_paths) {
    std::string relative = filepath;
    if (filepath.find(project_root) == 0) {
        relative = filepath.substr(project_root.size());
        if (!relative.empty() && relative[0] == '/') {
            relative = relative.substr(1);
        }
    }

    for (const auto& mod : module_paths) {
        if (relative.find(mod) == 0) {
            return mod;
        }
    }

    auto first_slash = relative.find('/');
    if (first_slash != std::string::npos) {
        return relative.substr(0, first_slash);
    }
    return "root";
}

// ============== FunctionDefCallback ==============

FunctionDefCallback::FunctionDefCallback(Storage& storage,
                                         const std::string& project_root,
                                         const std::vector<std::string>& module_paths)
    : storage_(storage), project_root_(project_root), module_paths_(module_paths) {
    CS_DEBUG("FunctionDefCallback initialized, project_root={}", project_root);
}

std::string FunctionDefCallback::getUSR(const Decl* decl) {
    llvm::SmallString<128> buf;
    if (clang::index::generateUSRForDecl(decl, buf)) {
        return "";
    }
    return std::string(buf.str());
}

std::string FunctionDefCallback::getSignature(const FunctionDecl* fd) {
    std::string sig = fd->getReturnType().getAsString() + " " + fd->getNameAsString() + "(";
    for (unsigned i = 0; i < fd->getNumParams(); ++i) {
        if (i > 0) sig += ", ";
        sig += fd->getParamDecl(i)->getType().getAsString();
        auto name = fd->getParamDecl(i)->getNameAsString();
        if (!name.empty()) {
            sig += " " + name;
        }
    }
    sig += ")";
    return sig;
}

void FunctionDefCallback::run(const MatchFinder::MatchResult& result) {
    const auto* fd = result.Nodes.getNodeAs<FunctionDecl>("func");
    if (!fd) return;

    auto& sm = *result.SourceManager;

    SourceLocation loc = fd->getLocation();
    if (!loc.isValid()) return;
    if (sm.isInSystemHeader(loc)) return;

    if (!fd->isThisDeclarationADefinition()) return;

    std::string usr = getUSR(fd);
    if (usr.empty()) return;
    if (seen_usrs_.count(usr)) return;
    seen_usrs_.insert(usr);

    auto ploc = sm.getPresumedLoc(loc);
    if (ploc.isInvalid()) return;

    std::string filename = ploc.getFilename();
    std::string module = resolveModule(filename, project_root_, module_paths_);

    FunctionInfo func;
    func.set_usr(usr);
    func.set_name(fd->getNameAsString());
    func.set_file(filename);
    func.set_line(ploc.getLine());
    func.set_column(ploc.getColumn());
    func.set_module(module);
    func.set_signature(getSignature(fd));

    storage_.putFunction(func);
    collected_count_++;

    if (collected_count_ % 1000 == 0) {
        CS_INFO("Collected {} function definitions", collected_count_);
    }
}

// ============== CallExprCallback ==============

CallExprCallback::CallExprCallback(Storage& storage)
    : storage_(storage) {
    CS_DEBUG("CallExprCallback initialized");
}

std::string CallExprCallback::getUSR(const Decl* decl) {
    llvm::SmallString<128> buf;
    if (clang::index::generateUSRForDecl(decl, buf)) {
        return "";
    }
    return std::string(buf.str());
}

void CallExprCallback::run(const MatchFinder::MatchResult& result) {
    const auto* call = result.Nodes.getNodeAs<CallExpr>("call");
    const auto* callee_decl = result.Nodes.getNodeAs<FunctionDecl>("callee");
    if (!call || !callee_decl) return;

    auto& sm = *result.SourceManager;

    SourceLocation call_loc = call->getBeginLoc();
    if (!call_loc.isValid()) return;
    if (sm.isInSystemHeader(call_loc)) return;

    // Find the enclosing function (caller)
    auto& ctx = *result.Context;
    auto parent_list = ctx.getParents(*call);
    const FunctionDecl* caller_decl = nullptr;

    // Walk up AST parents to find enclosing FunctionDecl
    std::vector<clang::DynTypedNode> worklist;
    for (const auto& p : parent_list) {
        worklist.push_back(p);
    }

    while (!worklist.empty() && !caller_decl) {
        auto node = worklist.back();
        worklist.pop_back();

        caller_decl = node.get<FunctionDecl>();
        if (!caller_decl) {
            auto next_parents = ctx.getParents(node);
            for (const auto& p : next_parents) {
                worklist.push_back(p);
            }
        }
    }

    if (!caller_decl) return;

    // Skip if caller is in system header
    auto caller_loc = caller_decl->getLocation();
    if (caller_loc.isValid() && sm.isInSystemHeader(caller_loc)) return;

    std::string caller_usr = getUSR(caller_decl);
    std::string callee_usr = getUSR(callee_decl);
    if (caller_usr.empty() || callee_usr.empty()) return;

    // Deduplicate
    std::string edge_key = caller_usr + "->" + callee_usr;
    if (seen_edges_.count(edge_key)) return;
    seen_edges_.insert(edge_key);

    auto ploc = sm.getPresumedLoc(call_loc);

    CallEdge edge;
    edge.set_caller_usr(caller_usr);
    edge.set_callee_usr(callee_usr);
    if (ploc.isValid()) {
        edge.set_call_file(ploc.getFilename());
        edge.set_call_line(ploc.getLine());
        edge.set_call_column(ploc.getColumn());
    }

    storage_.putCallEdge(edge);
    collected_count_++;

    if (collected_count_ % 5000 == 0) {
        CS_INFO("Collected {} call edges", collected_count_);
    }
}

}  // namespace codesage
