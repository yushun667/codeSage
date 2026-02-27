#include "function_collector.h"
#include "storage.h"
#include "logger.h"

#include <clang/AST/ASTContext.h>
#include <clang/AST/DeclBase.h>
#include <clang/AST/DeclCXX.h>
#include <clang/AST/Expr.h>
#include <clang/AST/ExprCXX.h>
#include <clang/AST/RecursiveASTVisitor.h>
#include <clang/Basic/SourceManager.h>
#include <clang/Index/USRGeneration.h>
#include <llvm/ADT/SmallString.h>

#include <deque>
#include <map>
#include <set>

using namespace clang;
using namespace clang::ast_matchers;

namespace codesage {

// Visits function body AST to find all function references, including those
// inside RecoveryExpr nodes where normal CallExpr matching fails.
class FuncRefVisitor : public RecursiveASTVisitor<FuncRefVisitor> {
public:
    struct FuncRef {
        const FunctionDecl* callee;
        SourceLocation loc;
    };
    std::vector<FuncRef> refs;

    bool VisitDeclRefExpr(DeclRefExpr* dre) {
        if (auto* fd = dyn_cast<FunctionDecl>(dre->getDecl()))
            refs.push_back({fd, dre->getLocation()});
        return true;
    }

    bool VisitMemberExpr(MemberExpr* me) {
        if (auto* fd = dyn_cast<CXXMethodDecl>(me->getMemberDecl()))
            refs.push_back({fd, me->getExprLoc()});
        return true;
    }

    bool VisitUnresolvedLookupExpr(UnresolvedLookupExpr* ule) {
        const FunctionDecl* candidate = nullptr;
        for (auto* d : ule->decls()) {
            const NamedDecl* nd = d;
            if (const auto* usd = dyn_cast<UsingShadowDecl>(nd))
                nd = usd->getTargetDecl();
            if (auto* fd = dyn_cast<FunctionDecl>(nd)) {
                if (candidate) return true;
                candidate = fd;
            }
        }
        if (candidate)
            refs.push_back({candidate, ule->getBeginLoc()});
        return true;
    }

    bool VisitUnresolvedMemberExpr(UnresolvedMemberExpr* ume) {
        const FunctionDecl* candidate = nullptr;
        for (auto* d : ume->decls()) {
            const NamedDecl* nd = d;
            if (const auto* usd = dyn_cast<UsingShadowDecl>(nd))
                nd = usd->getTargetDecl();
            if (auto* fd = dyn_cast<FunctionDecl>(nd)) {
                if (candidate) return true;
                candidate = fd;
            }
        }
        if (candidate)
            refs.push_back({candidate, ume->getBeginLoc()});
        return true;
    }
};

static bool isFuncPtrType(QualType qt) {
    qt = qt.getNonReferenceType().getCanonicalType();
    if (auto* pt = qt->getAs<PointerType>())
        return pt->getPointeeType()->isFunctionType();
    if (qt->isFunctionType())
        return true;
    return false;
}

static const FunctionDecl* extractFuncFromExpr(const Expr* e) {
    if (!e) return nullptr;
    e = e->IgnoreImplicit();
    if (const auto* uo = dyn_cast<UnaryOperator>(e)) {
        if (uo->getOpcode() == UO_AddrOf)
            e = uo->getSubExpr()->IgnoreImplicit();
    }
    if (const auto* dre = dyn_cast<DeclRefExpr>(e))
        return dyn_cast<FunctionDecl>(dre->getDecl());
    return nullptr;
}

// Collects function-pointer assignments and indirect calls within a function body.
class FuncPtrAnalysisVisitor : public RecursiveASTVisitor<FuncPtrAnalysisVisitor> {
public:
    // fp variable (VarDecl*) -> list of FunctionDecls assigned to it
    std::map<const VarDecl*, std::vector<const FunctionDecl*>> fp_assignments;

    struct IndirectCallInfo {
        const CallExpr* call;
        const VarDecl* var;        // non-null if callee is a local variable
        const FieldDecl* field;    // non-null if callee is a struct member
    };
    std::vector<IndirectCallInfo> indirect_calls;

    struct CallbackPassInfo {
        const CallExpr* call;       // the direct call expression
        const FunctionDecl* callee; // the function being called
        unsigned param_index;       // parameter position
        const FunctionDecl* callback_func; // function being passed
        SourceLocation loc;
    };
    std::vector<CallbackPassInfo> callback_passes;

    bool VisitVarDecl(VarDecl* vd) {
        if (!isFuncPtrType(vd->getType())) return true;
        if (!vd->hasInit()) return true;
        if (auto* fd = extractFuncFromExpr(vd->getInit()))
            fp_assignments[vd].push_back(fd);
        return true;
    }

    bool VisitBinaryOperator(BinaryOperator* bo) {
        if (bo->getOpcode() != BO_Assign) return true;
        auto* lhs = bo->getLHS()->IgnoreImplicit();
        if (auto* dre = dyn_cast<DeclRefExpr>(lhs)) {
            if (auto* vd = dyn_cast<VarDecl>(dre->getDecl())) {
                if (isFuncPtrType(vd->getType())) {
                    if (auto* fd = extractFuncFromExpr(bo->getRHS()))
                        fp_assignments[vd].push_back(fd);
                }
            }
        }
        return true;
    }

    bool VisitCallExpr(CallExpr* ce) {
        if (ce->getDirectCallee()) {
            checkCallbackArgs(ce);
            return true;
        }

        auto* callee_expr = ce->getCallee();
        if (!callee_expr) return true;
        callee_expr = callee_expr->IgnoreImpCasts();

        if (auto* dre = dyn_cast<DeclRefExpr>(callee_expr)) {
            if (auto* vd = dyn_cast<VarDecl>(dre->getDecl())) {
                indirect_calls.push_back({ce, vd, nullptr});
            }
        } else if (auto* me = dyn_cast<MemberExpr>(callee_expr)) {
            if (auto* fd_member = dyn_cast<FieldDecl>(me->getMemberDecl())) {
                indirect_calls.push_back({ce, nullptr, fd_member});
            }
        }
        return true;
    }

private:
    void checkCallbackArgs(CallExpr* ce) {
        auto* callee = ce->getDirectCallee();
        if (!callee) return;
        for (unsigned i = 0; i < ce->getNumArgs(); ++i) {
            if (i >= callee->getNumParams()) break;
            if (!isFuncPtrType(callee->getParamDecl(i)->getType())) continue;
            if (auto* cb = extractFuncFromExpr(ce->getArg(i))) {
                callback_passes.push_back({ce, callee, i, cb, ce->getBeginLoc()});
            }
        }
    }
};

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
                                         const std::vector<std::string>& module_paths,
                                         CallExprCallback* call_cb)
    : storage_(storage), project_root_(project_root),
      module_paths_(module_paths), call_cb_(call_cb) {
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

    if (sm.isInSystemHeader(loc)) {
        auto ploc = sm.getPresumedLoc(loc);
        if (ploc.isValid()) {
            std::string filename = ploc.getFilename();
            if (filename.find(project_root_) != 0) {
                return;
            }
        } else {
            return;
        }
    }

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

    if (call_cb_ && fd->hasBody()) {
        call_cb_->analyzeIndirectCalls(*result.Context, sm, fd);
        call_cb_->collectReferencesFromBody(sm, fd);
    }
}

// ============== CallExprCallback ==============

CallExprCallback::CallExprCallback(Storage& storage, const std::string& project_root)
    : storage_(storage), project_root_(project_root) {
    CS_DEBUG("CallExprCallback initialized, project_root={}", project_root);
}

bool CallExprCallback::shouldSkipLocation(SourceManager& sm, SourceLocation loc) const {
    if (!loc.isValid()) return true;
    if (!sm.isInSystemHeader(loc)) return false;

    if (!project_root_.empty()) {
        auto ploc = sm.getPresumedLoc(loc);
        if (ploc.isValid()) {
            std::string filename = ploc.getFilename();
            if (filename.find(project_root_) == 0) {
                return false;
            }
        }
    }
    return true;
}

std::string CallExprCallback::getUSR(const Decl* decl) {
    llvm::SmallString<128> buf;
    if (clang::index::generateUSRForDecl(decl, buf)) {
        return "";
    }
    return std::string(buf.str());
}

void CallExprCallback::run(const MatchFinder::MatchResult& result) {
    auto& sm = *result.SourceManager;
    auto& ctx = *result.Context;

    const FunctionDecl* callee_decl = nullptr;
    SourceLocation call_loc;

    if (const auto* call = result.Nodes.getNodeAs<CallExpr>("call")) {
        callee_decl = call->getDirectCallee();
        if (!callee_decl) return;
        call_loc = call->getBeginLoc();
        findCallerAndStore(ctx, sm, *call, callee_decl, call_loc);

    } else if (const auto* ctor =
                   result.Nodes.getNodeAs<CXXConstructExpr>("construct")) {
        if (ctor->getParenOrBraceRange().isInvalid()) return;
        callee_decl = ctor->getConstructor();
        if (!callee_decl) return;
        call_loc = ctor->getBeginLoc();
        findCallerAndStore(ctx, sm, *ctor, callee_decl, call_loc);
    }
}

void CallExprCallback::analyzeIndirectCalls(ASTContext& ctx, SourceManager& sm,
                                             const FunctionDecl* caller) {
    if (!caller || !caller->hasBody()) return;
    if (shouldSkipLocation(sm, caller->getLocation())) return;

    std::string caller_usr = getUSR(caller);
    if (caller_usr.empty()) return;

    FuncPtrAnalysisVisitor visitor;
    visitor.TraverseStmt(caller->getBody());

    // Resolve indirect calls via local variable assignments
    for (const auto& ic : visitor.indirect_calls) {
        if (!ic.var) continue;
        auto it = visitor.fp_assignments.find(ic.var);
        if (it == visitor.fp_assignments.end()) continue;

        for (const auto* target : it->second) {
            if (storeEdgeDirectly(sm, caller, target,
                                  ic.call->getBeginLoc(), "indirect"))
                indirect_count_++;
        }
    }

    // Record callback passes: function passed as argument to another function
    for (const auto& cp : visitor.callback_passes) {
        auto callee_usr = getUSR(cp.callee);
        auto cb_usr = getUSR(cp.callback_func);
        if (callee_usr.empty() || cb_usr.empty()) continue;

        auto ploc = sm.getPresumedLoc(cp.loc);

        CallbackPass pass;
        pass.set_caller_usr(caller_usr);
        pass.set_callee_usr(callee_usr);
        pass.set_param_index(cp.param_index);
        pass.set_callback_usr(cb_usr);
        if (ploc.isValid()) {
            pass.set_call_file(ploc.getFilename());
            pass.set_call_line(ploc.getLine());
        }

        storage_.putCallbackPass(pass);
        callback_pass_count_++;
    }
}

template <typename ExprT>
bool CallExprCallback::findCallerAndStore(ASTContext& ctx, SourceManager& sm,
                                          const ExprT& expr,
                                          const FunctionDecl* callee_decl,
                                          SourceLocation call_loc,
                                          const std::string& edge_type) {
    if (!call_loc.isValid()) return false;

    if (shouldSkipLocation(sm, call_loc)) {
        auto ploc = sm.getPresumedLoc(call_loc);
        if (ploc.isValid()) {
            CS_DEBUG("Skipped call in system header: {}:{}", ploc.getFilename(), ploc.getLine());
        }
        return false;
    }

    const FunctionDecl* caller_decl = nullptr;
    std::deque<clang::DynTypedNode> worklist;
    std::set<const void*> visited;

    auto parent_list = ctx.getParents(expr);
    for (const auto& p : parent_list) {
        worklist.push_back(p);
    }

    while (!worklist.empty() && !caller_decl) {
        auto node = worklist.front();
        worklist.pop_front();

        const void* node_ptr = node.getMemoizationData();
        if (node_ptr && !visited.insert(node_ptr).second) continue;

        caller_decl = node.get<FunctionDecl>();
        if (!caller_decl) {
            auto next_parents = ctx.getParents(node);
            for (const auto& p : next_parents) {
                worklist.push_back(p);
            }
        }
    }

    if (!caller_decl) {
        CS_DEBUG("Skipped call: no enclosing function found");
        skipped_count_++;
        return false;
    }

    auto caller_loc = caller_decl->getLocation();
    if (shouldSkipLocation(sm, caller_loc)) {
        CS_DEBUG("Skipped call: caller {} in system header", caller_decl->getNameAsString());
        skipped_count_++;
        return false;
    }

    std::string caller_usr = getUSR(caller_decl);
    std::string callee_usr = getUSR(callee_decl);
    if (caller_usr.empty() || callee_usr.empty()) {
        CS_DEBUG("Skipped call: empty USR (caller={}, callee={})",
                 caller_decl->getNameAsString(), callee_decl->getNameAsString());
        skipped_count_++;
        return false;
    }

    std::string edge_key = caller_usr + "->" + callee_usr;
    if (seen_edges_.count(edge_key)) return false;
    seen_edges_.insert(edge_key);

    auto ploc = sm.getPresumedLoc(call_loc);

    CallEdge edge;
    edge.set_caller_usr(caller_usr);
    edge.set_callee_usr(callee_usr);
    edge.set_edge_type(edge_type);
    if (ploc.isValid()) {
        edge.set_call_file(ploc.getFilename());
        edge.set_call_line(ploc.getLine());
        edge.set_call_column(ploc.getColumn());
    }

    storage_.putCallEdge(edge);
    collected_count_++;

    if (collected_count_ % 5000 == 0) {
        CS_INFO("Collected {} call edges ({} skipped)", collected_count_, skipped_count_);
    }
    return true;
}

void CallExprCallback::collectReferencesFromBody(SourceManager& sm,
                                                  const FunctionDecl* caller) {
    if (!caller || !caller->hasBody()) return;

    FuncRefVisitor visitor;
    visitor.TraverseStmt(caller->getBody());

    for (const auto& ref : visitor.refs) {
        if (storeEdgeDirectly(sm, caller, ref.callee, ref.loc))
            recovered_count_++;
    }
}

bool CallExprCallback::storeEdgeDirectly(SourceManager& sm,
                                          const FunctionDecl* caller,
                                          const FunctionDecl* callee,
                                          SourceLocation ref_loc,
                                          const std::string& edge_type) {
    if (!ref_loc.isValid()) return false;
    if (shouldSkipLocation(sm, ref_loc)) return false;
    if (shouldSkipLocation(sm, caller->getLocation())) return false;

    std::string caller_usr = getUSR(caller);
    std::string callee_usr = getUSR(callee);
    if (caller_usr.empty() || callee_usr.empty()) return false;

    std::string edge_key = caller_usr + "->" + callee_usr;
    if (seen_edges_.count(edge_key)) return false;
    seen_edges_.insert(edge_key);

    auto ploc = sm.getPresumedLoc(ref_loc);

    CallEdge edge;
    edge.set_caller_usr(caller_usr);
    edge.set_callee_usr(callee_usr);
    edge.set_edge_type(edge_type);
    if (ploc.isValid()) {
        edge.set_call_file(ploc.getFilename());
        edge.set_call_line(ploc.getLine());
        edge.set_call_column(ploc.getColumn());
    }

    storage_.putCallEdge(edge);
    collected_count_++;
    return true;
}

}  // namespace codesage
