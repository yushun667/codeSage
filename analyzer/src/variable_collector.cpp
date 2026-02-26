#include "variable_collector.h"
#include "function_collector.h"
#include "storage.h"
#include "logger.h"

#include <clang/AST/ASTContext.h>
#include <clang/AST/Expr.h>
#include <clang/AST/ParentMapContext.h>
#include <clang/Basic/SourceManager.h>
#include <clang/Index/USRGeneration.h>
#include <llvm/ADT/SmallString.h>

using namespace clang;
using namespace clang::ast_matchers;

namespace codesage {

// ============== GlobalVarDeclCallback ==============

GlobalVarDeclCallback::GlobalVarDeclCallback(Storage& storage,
                                             const std::string& project_root,
                                             const std::vector<std::string>& module_paths)
    : storage_(storage), project_root_(project_root), module_paths_(module_paths) {
    CS_DEBUG("GlobalVarDeclCallback initialized");
}

std::string GlobalVarDeclCallback::getUSR(const Decl* decl) {
    llvm::SmallString<128> buf;
    if (clang::index::generateUSRForDecl(decl, buf)) {
        return "";
    }
    return std::string(buf.str());
}

void GlobalVarDeclCallback::run(const MatchFinder::MatchResult& result) {
    const auto* vd = result.Nodes.getNodeAs<VarDecl>("globalVar");
    if (!vd) return;

    auto& sm = *result.SourceManager;

    SourceLocation loc = vd->getLocation();
    if (!loc.isValid()) return;
    if (sm.isInSystemHeader(loc)) return;

    std::string usr = getUSR(vd);
    if (usr.empty()) return;
    if (seen_usrs_.count(usr)) return;
    seen_usrs_.insert(usr);

    auto ploc = sm.getPresumedLoc(loc);
    if (ploc.isInvalid()) return;

    std::string filename = ploc.getFilename();
    std::string module = resolveModule(filename, project_root_, module_paths_);

    GlobalVarInfo var;
    var.set_usr(usr);
    var.set_name(vd->getNameAsString());
    var.set_file(filename);
    var.set_line(ploc.getLine());
    var.set_type(vd->getType().getAsString());
    var.set_is_extern(vd->hasExternalStorage());
    var.set_module(module);

    storage_.putGlobalVar(var);
    collected_count_++;

    if (collected_count_ % 500 == 0) {
        CS_INFO("Collected {} global variable declarations", collected_count_);
    }
}

// ============== VarRefCallback ==============

VarRefCallback::VarRefCallback(Storage& storage)
    : storage_(storage) {
    CS_DEBUG("VarRefCallback initialized");
}

std::string VarRefCallback::getUSR(const Decl* decl) {
    llvm::SmallString<128> buf;
    if (clang::index::generateUSRForDecl(decl, buf)) {
        return "";
    }
    return std::string(buf.str());
}

bool VarRefCallback::isWriteAccess(const DeclRefExpr* ref,
                                    const MatchFinder::MatchResult& result) {
    auto& ctx = *result.Context;
    auto parents = ctx.getParents(*ref);

    for (const auto& parent : parents) {
        // Check if parent is a binary operator with assignment
        if (const auto* binOp = parent.get<BinaryOperator>()) {
            if (binOp->isAssignmentOp()) {
                // Write if ref is on LHS
                if (binOp->getLHS()->IgnoreParenCasts() == ref) {
                    return true;
                }
            }
        }
        // Check if parent is a unary operator (++/--)
        if (const auto* unOp = parent.get<UnaryOperator>()) {
            if (unOp->isIncrementDecrementOp()) {
                return true;
            }
        }
        // CompoundAssignOperator (+=, -= etc)
        if (const auto* compAssign = parent.get<CompoundAssignOperator>()) {
            if (compAssign->getLHS()->IgnoreParenCasts() == ref) {
                return true;
            }
        }
    }
    return false;
}

void VarRefCallback::run(const MatchFinder::MatchResult& result) {
    const auto* ref = result.Nodes.getNodeAs<DeclRefExpr>("varRef");
    const auto* vd = result.Nodes.getNodeAs<VarDecl>("refVar");
    if (!ref || !vd) return;

    auto& sm = *result.SourceManager;

    SourceLocation ref_loc = ref->getLocation();
    if (!ref_loc.isValid()) return;
    if (sm.isInSystemHeader(ref_loc)) return;

    // Find enclosing function
    auto& ctx = *result.Context;
    const FunctionDecl* enclosing_func = nullptr;

    std::vector<clang::DynTypedNode> worklist;
    auto parents = ctx.getParents(*ref);
    for (const auto& p : parents) {
        worklist.push_back(p);
    }

    while (!worklist.empty() && !enclosing_func) {
        auto node = worklist.back();
        worklist.pop_back();
        enclosing_func = node.get<FunctionDecl>();
        if (!enclosing_func) {
            auto next_parents = ctx.getParents(node);
            for (const auto& p : next_parents) {
                worklist.push_back(p);
            }
        }
    }

    if (!enclosing_func) return;

    auto func_loc = enclosing_func->getLocation();
    if (func_loc.isValid() && sm.isInSystemHeader(func_loc)) return;

    std::string var_usr = getUSR(vd);
    std::string func_usr = getUSR(enclosing_func);
    if (var_usr.empty() || func_usr.empty()) return;

    bool is_write = isWriteAccess(ref, result);

    // Deduplicate: same function + same variable + same write/read type
    std::string access_id = func_usr + ":" + var_usr + ":" + (is_write ? "W" : "R");
    if (seen_accesses_.count(access_id)) return;
    seen_accesses_.insert(access_id);

    auto ploc = sm.getPresumedLoc(ref_loc);

    GlobalVarAccess access;
    access.set_var_usr(var_usr);
    access.set_function_usr(func_usr);
    access.set_is_write(is_write);
    if (ploc.isValid()) {
        access.set_access_file(ploc.getFilename());
        access.set_access_line(ploc.getLine());
        access.set_access_column(ploc.getColumn());
    }

    storage_.putAccess(access);
    collected_count_++;

    if (collected_count_ % 2000 == 0) {
        CS_INFO("Collected {} variable accesses", collected_count_);
    }
}

}  // namespace codesage
