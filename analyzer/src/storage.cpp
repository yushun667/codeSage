#include "storage.h"
#include "logger.h"

#include <rocksdb/write_batch.h>
#include <rocksdb/iterator.h>
#include <chrono>

namespace codesage {

// ============== KeyBuilder ==============

std::string KeyBuilder::funcKey(const std::string& usr) {
    return "func:" + usr;
}

std::string KeyBuilder::fwdEdgeKey(const std::string& caller, const std::string& callee) {
    return "edge:fwd:" + caller + ":" + callee;
}

std::string KeyBuilder::bwdEdgeKey(const std::string& callee, const std::string& caller) {
    return "edge:bwd:" + callee + ":" + caller;
}

std::string KeyBuilder::varKey(const std::string& usr) {
    return "var:" + usr;
}

std::string KeyBuilder::accessKey(const std::string& func_usr, const std::string& var_usr) {
    return "access:" + func_usr + ":" + var_usr;
}

std::string KeyBuilder::fnameIndexKey(const std::string& name, const std::string& usr) {
    return "idx:fname:" + name + ":" + usr;
}

std::string KeyBuilder::vnameIndexKey(const std::string& name, const std::string& usr) {
    return "idx:vname:" + name + ":" + usr;
}

std::string KeyBuilder::moduleIndexKey(const std::string& module, const std::string& usr) {
    return "idx:module:" + module + ":" + usr;
}

std::string KeyBuilder::parsedFileKey(const std::string& filepath) {
    return "meta:parsed:" + filepath;
}

std::string KeyBuilder::metaKey(const std::string& key) {
    return "meta:" + key;
}

std::string KeyBuilder::fwdEdgePrefix(const std::string& caller) {
    return "edge:fwd:" + caller + ":";
}

std::string KeyBuilder::bwdEdgePrefix(const std::string& callee) {
    return "edge:bwd:" + callee + ":";
}

std::string KeyBuilder::accessPrefixByFunc(const std::string& func_usr) {
    return "access:" + func_usr + ":";
}

std::string KeyBuilder::accessPrefixByVar(const std::string& var_usr) {
    return "access_var:" + var_usr + ":";
}

std::string KeyBuilder::fnameSearchPrefix(const std::string& name_prefix) {
    return "idx:fname:" + name_prefix;
}

std::string KeyBuilder::vnameSearchPrefix(const std::string& name_prefix) {
    return "idx:vname:" + name_prefix;
}

// ============== Storage ==============

Storage::Storage() {
    options_.create_if_missing = true;
    options_.max_open_files = 256;
    options_.write_buffer_size = 64 * 1024 * 1024;
    options_.max_write_buffer_number = 3;
    options_.compression = rocksdb::kNoCompression;
}

Storage::~Storage() {
    close();
}

bool Storage::open(const std::string& db_path) {
    CS_INFO("Opening database at {}", db_path);
    db_path_ = db_path;
    rocksdb::Status status = rocksdb::DB::Open(options_, db_path, &db_);
    if (!status.ok()) {
        CS_ERROR("Failed to open database: {}", status.ToString());
        return false;
    }
    CS_INFO("Database opened successfully");
    return true;
}

void Storage::close() {
    if (db_) {
        CS_INFO("Closing database");
        delete db_;
        db_ = nullptr;
    }
}

bool Storage::isOpen() const {
    return db_ != nullptr;
}

bool Storage::put(const std::string& key, const std::string& value) {
    auto status = db_->Put(rocksdb::WriteOptions(), key, value);
    if (!status.ok()) {
        CS_ERROR("Put failed for key '{}': {}", key.substr(0, 60), status.ToString());
        return false;
    }
    return true;
}

std::optional<std::string> Storage::get(const std::string& key) {
    std::string value;
    auto status = db_->Get(rocksdb::ReadOptions(), key, &value);
    if (status.IsNotFound()) {
        return std::nullopt;
    }
    if (!status.ok()) {
        CS_ERROR("Get failed for key '{}': {}", key.substr(0, 60), status.ToString());
        return std::nullopt;
    }
    return value;
}

bool Storage::del(const std::string& key) {
    auto status = db_->Delete(rocksdb::WriteOptions(), key);
    if (!status.ok()) {
        CS_ERROR("Delete failed for key '{}': {}", key.substr(0, 60), status.ToString());
        return false;
    }
    return true;
}

// ---------- Function operations ----------

bool Storage::putFunction(const FunctionInfo& func) {
    CS_DEBUG("putFunction: {} ({})", func.name(), func.usr());
    std::string data;
    if (!func.SerializeToString(&data)) {
        CS_ERROR("Failed to serialize FunctionInfo for {}", func.usr());
        return false;
    }

    return writeBatch([&](rocksdb::WriteBatch& batch) {
        batch.Put(KeyBuilder::funcKey(func.usr()), data);
        batch.Put(KeyBuilder::fnameIndexKey(func.name(), func.usr()), "");
        if (!func.module().empty()) {
            batch.Put(KeyBuilder::moduleIndexKey(func.module(), func.usr()), "");
        }
    });
}

std::optional<FunctionInfo> Storage::getFunction(const std::string& usr) {
    CS_DEBUG("getFunction: {}", usr);
    auto data = get(KeyBuilder::funcKey(usr));
    if (!data) return std::nullopt;

    FunctionInfo func;
    if (!func.ParseFromString(*data)) {
        CS_ERROR("Failed to parse FunctionInfo for {}", usr);
        return std::nullopt;
    }
    return func;
}

std::vector<FunctionInfo> Storage::searchFunctions(const std::string& query, int limit) {
    CS_DEBUG("searchFunctions: query='{}', limit={}", query, limit);
    std::vector<FunctionInfo> results;

    std::string prefix = KeyBuilder::fnameSearchPrefix(query);
    const size_t fname_prefix_len = 10; // "idx:fname:" is 10 chars
    iterateWithPrefix(prefix, [&](const std::string& key, const std::string&) -> bool {
        if (static_cast<int>(results.size()) >= limit) return false;

        // Key format: "idx:fname:<name>:<usr>" — name has no colons
        auto sep = key.find(':', fname_prefix_len);
        if (sep == std::string::npos) return true;
        std::string usr = key.substr(sep + 1);

        auto func = getFunction(usr);
        if (func) {
            results.push_back(*func);
        }
        return true;
    });

    CS_DEBUG("searchFunctions: found {} results", results.size());
    return results;
}

// ---------- Call edge operations ----------

bool Storage::putCallEdge(const CallEdge& edge) {
    CS_DEBUG("putCallEdge: {} -> {}", edge.caller_usr(), edge.callee_usr());
    std::string data;
    if (!edge.SerializeToString(&data)) {
        CS_ERROR("Failed to serialize CallEdge");
        return false;
    }

    return writeBatch([&](rocksdb::WriteBatch& batch) {
        batch.Put(KeyBuilder::fwdEdgeKey(edge.caller_usr(), edge.callee_usr()), data);
        batch.Put(KeyBuilder::bwdEdgeKey(edge.callee_usr(), edge.caller_usr()), data);
    });
}

std::vector<CallEdge> Storage::getForwardEdges(const std::string& caller_usr) {
    CS_DEBUG("getForwardEdges: {}", caller_usr);
    std::vector<CallEdge> edges;

    std::string prefix = KeyBuilder::fwdEdgePrefix(caller_usr);
    iterateWithPrefix(prefix, [&](const std::string&, const std::string& value) -> bool {
        CallEdge edge;
        if (edge.ParseFromString(value)) {
            edges.push_back(edge);
        }
        return true;
    });

    return edges;
}

std::vector<CallEdge> Storage::getBackwardEdges(const std::string& callee_usr) {
    CS_DEBUG("getBackwardEdges: {}", callee_usr);
    std::vector<CallEdge> edges;

    std::string prefix = KeyBuilder::bwdEdgePrefix(callee_usr);
    iterateWithPrefix(prefix, [&](const std::string&, const std::string& value) -> bool {
        CallEdge edge;
        if (edge.ParseFromString(value)) {
            edges.push_back(edge);
        }
        return true;
    });

    return edges;
}

// ---------- Global variable operations ----------

bool Storage::putGlobalVar(const GlobalVarInfo& var) {
    CS_DEBUG("putGlobalVar: {} ({})", var.name(), var.usr());
    std::string data;
    if (!var.SerializeToString(&data)) {
        CS_ERROR("Failed to serialize GlobalVarInfo for {}", var.usr());
        return false;
    }

    return writeBatch([&](rocksdb::WriteBatch& batch) {
        batch.Put(KeyBuilder::varKey(var.usr()), data);
        batch.Put(KeyBuilder::vnameIndexKey(var.name(), var.usr()), "");
        if (!var.module().empty()) {
            batch.Put(KeyBuilder::moduleIndexKey(var.module(), var.usr()), "");
        }
    });
}

std::optional<GlobalVarInfo> Storage::getGlobalVar(const std::string& usr) {
    CS_DEBUG("getGlobalVar: {}", usr);
    auto data = get(KeyBuilder::varKey(usr));
    if (!data) return std::nullopt;

    GlobalVarInfo var;
    if (!var.ParseFromString(*data)) {
        CS_ERROR("Failed to parse GlobalVarInfo for {}", usr);
        return std::nullopt;
    }
    return var;
}

std::vector<GlobalVarInfo> Storage::searchVariables(const std::string& query, int limit) {
    CS_DEBUG("searchVariables: query='{}', limit={}", query, limit);
    std::vector<GlobalVarInfo> results;

    std::string prefix = KeyBuilder::vnameSearchPrefix(query);
    const size_t vname_prefix_len = 10; // "idx:vname:" is 10 chars
    iterateWithPrefix(prefix, [&](const std::string& key, const std::string&) -> bool {
        if (static_cast<int>(results.size()) >= limit) return false;

        // Key format: "idx:vname:<name>:<usr>" — name has no colons
        auto sep = key.find(':', vname_prefix_len);
        if (sep == std::string::npos) return true;
        std::string usr = key.substr(sep + 1);

        auto var = getGlobalVar(usr);
        if (var) {
            results.push_back(*var);
        }
        return true;
    });

    CS_DEBUG("searchVariables: found {} results", results.size());
    return results;
}

// ---------- Access operations ----------

bool Storage::putAccess(const GlobalVarAccess& access) {
    CS_DEBUG("putAccess: func={} var={} write={}", access.function_usr(), access.var_usr(), access.is_write());
    std::string data;
    if (!access.SerializeToString(&data)) {
        CS_ERROR("Failed to serialize GlobalVarAccess");
        return false;
    }

    return writeBatch([&](rocksdb::WriteBatch& batch) {
        batch.Put(KeyBuilder::accessKey(access.function_usr(), access.var_usr()), data);
        // Reverse index: var -> func
        std::string rev_key = "access_var:" + access.var_usr() + ":" + access.function_usr();
        batch.Put(rev_key, data);
    });
}

std::vector<GlobalVarAccess> Storage::getAccessesByFunction(const std::string& func_usr) {
    CS_DEBUG("getAccessesByFunction: {}", func_usr);
    std::vector<GlobalVarAccess> accesses;

    std::string prefix = KeyBuilder::accessPrefixByFunc(func_usr);
    iterateWithPrefix(prefix, [&](const std::string&, const std::string& value) -> bool {
        GlobalVarAccess access;
        if (access.ParseFromString(value)) {
            accesses.push_back(access);
        }
        return true;
    });

    return accesses;
}

std::vector<GlobalVarAccess> Storage::getAccessesByVariable(const std::string& var_usr) {
    CS_DEBUG("getAccessesByVariable: {}", var_usr);
    std::vector<GlobalVarAccess> accesses;

    std::string prefix = KeyBuilder::accessPrefixByVar(var_usr);
    iterateWithPrefix(prefix, [&](const std::string&, const std::string& value) -> bool {
        GlobalVarAccess access;
        if (access.ParseFromString(value)) {
            accesses.push_back(access);
        }
        return true;
    });

    return accesses;
}

// ---------- Parsed file tracking ----------

bool Storage::markFileParsed(const std::string& filepath) {
    CS_DEBUG("markFileParsed: {}", filepath);
    auto now = std::chrono::system_clock::now();
    auto ts = std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count();
    return put(KeyBuilder::parsedFileKey(filepath), std::to_string(ts));
}

bool Storage::isFileParsed(const std::string& filepath) {
    return get(KeyBuilder::parsedFileKey(filepath)).has_value();
}

std::vector<std::string> Storage::getParsedFiles() {
    std::vector<std::string> files;
    std::string prefix = "meta:parsed:";
    iterateWithPrefix(prefix, [&](const std::string& key, const std::string&) -> bool {
        files.push_back(key.substr(prefix.size()));
        return true;
    });
    return files;
}

// ---------- Meta operations ----------

bool Storage::putMeta(const std::string& key, const std::string& value) {
    return put(KeyBuilder::metaKey(key), value);
}

std::optional<std::string> Storage::getMeta(const std::string& key) {
    return get(KeyBuilder::metaKey(key));
}

// ---------- Iteration ----------

void Storage::iterateWithPrefix(const std::string& prefix,
                                 const std::function<bool(const std::string&, const std::string&)>& callback) {
    std::unique_ptr<rocksdb::Iterator> it(db_->NewIterator(rocksdb::ReadOptions()));
    for (it->Seek(prefix); it->Valid(); it->Next()) {
        std::string key = it->key().ToString();
        if (key.compare(0, prefix.size(), prefix) != 0) break;
        if (!callback(key, it->value().ToString())) break;
    }
}

// ---------- Batch write ----------

bool Storage::writeBatch(const std::function<void(rocksdb::WriteBatch&)>& batchFn) {
    rocksdb::WriteBatch batch;
    batchFn(batch);
    auto status = db_->Write(rocksdb::WriteOptions(), &batch);
    if (!status.ok()) {
        CS_ERROR("WriteBatch failed: {}", status.ToString());
        return false;
    }
    return true;
}

// ---------- Stats ----------

size_t Storage::countFunctions() {
    size_t count = 0;
    iterateWithPrefix("func:", [&](const std::string&, const std::string&) -> bool {
        count++;
        return true;
    });
    return count;
}

size_t Storage::countEdges() {
    size_t count = 0;
    iterateWithPrefix("edge:fwd:", [&](const std::string&, const std::string&) -> bool {
        count++;
        return true;
    });
    return count;
}

size_t Storage::countVariables() {
    size_t count = 0;
    iterateWithPrefix("var:", [&](const std::string&, const std::string&) -> bool {
        count++;
        return true;
    });
    return count;
}

}  // namespace codesage
