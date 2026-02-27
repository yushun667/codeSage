#pragma once

#include <string>
#include <vector>
#include <optional>
#include <functional>

#include <rocksdb/db.h>
#include <rocksdb/options.h>

#include "generated/codesage.pb.h"

namespace codesage {

// Key构造工具
struct KeyBuilder {
    static std::string funcKey(const std::string& usr);
    static std::string fwdEdgeKey(const std::string& caller, const std::string& callee);
    static std::string bwdEdgeKey(const std::string& callee, const std::string& caller);
    static std::string varKey(const std::string& usr);
    static std::string accessKey(const std::string& func_usr, const std::string& var_usr);
    static std::string fnameIndexKey(const std::string& name, const std::string& usr);
    static std::string vnameIndexKey(const std::string& name, const std::string& usr);
    static std::string moduleIndexKey(const std::string& module, const std::string& usr);
    static std::string parsedFileKey(const std::string& filepath);
    static std::string metaKey(const std::string& key);

    static std::string cbPassKey(const std::string& callee_usr, const std::string& caller_usr,
                                  int param_index, const std::string& callback_usr);
    static std::string cbPassPrefix(const std::string& callee_usr);

    static std::string fwdEdgePrefix(const std::string& caller);
    static std::string bwdEdgePrefix(const std::string& callee);
    static std::string accessPrefixByFunc(const std::string& func_usr);
    static std::string accessPrefixByVar(const std::string& var_usr);
    static std::string fnameSearchPrefix(const std::string& name_prefix);
    static std::string vnameSearchPrefix(const std::string& name_prefix);
};

class Storage {
public:
    Storage();
    ~Storage();

    bool open(const std::string& db_path);
    void close();
    bool isOpen() const;

    // Function operations
    bool putFunction(const FunctionInfo& func);
    std::optional<FunctionInfo> getFunction(const std::string& usr);
    std::vector<FunctionInfo> searchFunctions(const std::string& query, int limit = 50);

    // Call edge operations
    bool putCallEdge(const CallEdge& edge);
    std::vector<CallEdge> getForwardEdges(const std::string& caller_usr);
    std::vector<CallEdge> getBackwardEdges(const std::string& callee_usr);

    // Callback pass tracking (function pointer parameter passing)
    bool putCallbackPass(const CallbackPass& pass);
    std::vector<CallbackPass> getCallbackPassesByCallee(const std::string& callee_usr);
    std::vector<CallbackPass> getAllCallbackPasses();

    // Global variable operations
    bool putGlobalVar(const GlobalVarInfo& var);
    std::optional<GlobalVarInfo> getGlobalVar(const std::string& usr);
    std::vector<GlobalVarInfo> searchVariables(const std::string& query, int limit = 50);

    // Access operations
    bool putAccess(const GlobalVarAccess& access);
    std::vector<GlobalVarAccess> getAccessesByFunction(const std::string& func_usr);
    std::vector<GlobalVarAccess> getAccessesByVariable(const std::string& var_usr);

    // Parsed file tracking
    bool markFileParsed(const std::string& filepath);
    bool isFileParsed(const std::string& filepath);
    std::vector<std::string> getParsedFiles();

    // Meta operations
    bool putMeta(const std::string& key, const std::string& value);
    std::optional<std::string> getMeta(const std::string& key);

    // Iteration helpers
    void iterateWithPrefix(const std::string& prefix,
                           const std::function<bool(const std::string&, const std::string&)>& callback);

    // Batch write for performance
    bool writeBatch(const std::function<void(rocksdb::WriteBatch&)>& batchFn);

    // Stats
    size_t countFunctions();
    size_t countEdges();
    size_t countVariables();

private:
    bool put(const std::string& key, const std::string& value);
    std::optional<std::string> get(const std::string& key);
    bool del(const std::string& key);

    rocksdb::DB* db_ = nullptr;
    rocksdb::Options options_;
    std::string db_path_;
};

}  // namespace codesage
