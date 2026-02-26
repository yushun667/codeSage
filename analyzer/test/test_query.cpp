#include <gtest/gtest.h>
#include <filesystem>

#include "storage.h"
#include "query_engine.h"
#include "logger.h"

namespace fs = std::filesystem;
using namespace codesage;

class QueryEngineTest : public ::testing::Test {
protected:
    void SetUp() override {
        Logger::init("", spdlog::level::warn);
        test_db_path_ = fs::temp_directory_path() / "codesage_query_test_db";
        fs::remove_all(test_db_path_);
        ASSERT_TRUE(storage_.open(test_db_path_.string()));

        setupTestData();
    }

    void TearDown() override {
        storage_.close();
        fs::remove_all(test_db_path_);
        Logger::shutdown();
    }

    void setupTestData() {
        // Functions: main -> compute_result -> process_data -> helper_function
        //                   \-> read_config
        auto addFunc = [&](const std::string& usr, const std::string& name,
                           const std::string& file, int line) {
            FunctionInfo f;
            f.set_usr(usr); f.set_name(name);
            f.set_file(file); f.set_line(line);
            f.set_module("root");
            storage_.putFunction(f);
        };

        addFunc("u:main", "main", "main.c", 20);
        addFunc("u:compute", "compute_result", "main.c", 14);
        addFunc("u:process", "process_data", "main.c", 9);
        addFunc("u:helper", "helper_function", "lib.c", 5);
        addFunc("u:read_cfg", "read_config", "lib.c", 10);
        addFunc("u:init", "init_library", "lib.c", 14);
        addFunc("u:cleanup", "cleanup_library", "lib.c", 18);

        auto addEdge = [&](const std::string& caller, const std::string& callee) {
            CallEdge e;
            e.set_caller_usr(caller); e.set_callee_usr(callee);
            storage_.putCallEdge(e);
        };

        addEdge("u:main", "u:init");
        addEdge("u:main", "u:compute");
        addEdge("u:main", "u:cleanup");
        addEdge("u:compute", "u:read_cfg");
        addEdge("u:compute", "u:process");
        addEdge("u:process", "u:helper");
    }

    Storage storage_;
    fs::path test_db_path_;
};

TEST_F(QueryEngineTest, SearchFunctions) {
    QueryEngine engine(storage_);
    auto results = engine.searchFunctions("process", 10);
    ASSERT_EQ(results.size(), 1);
    EXPECT_EQ(results[0].name(), "process_data");
}

TEST_F(QueryEngineTest, GetFunctionInfo) {
    QueryEngine engine(storage_);
    auto func = engine.getFunctionInfo("u:main");
    ASSERT_TRUE(func.has_value());
    EXPECT_EQ(func->name(), "main");
}

TEST_F(QueryEngineTest, ForwardCallGraph_Depth1) {
    QueryEngine engine(storage_);
    auto response = engine.getForwardCallGraph("u:main", 1);

    EXPECT_GE(response.nodes_size(), 4); // main + init + compute + cleanup
    EXPECT_GE(response.edges_size(), 3);
}

TEST_F(QueryEngineTest, ForwardCallGraph_Depth3) {
    QueryEngine engine(storage_);
    auto response = engine.getForwardCallGraph("u:main", 3);

    // Should include all 7 functions
    EXPECT_EQ(response.nodes_size(), 7);
    EXPECT_EQ(response.edges_size(), 6);
}

TEST_F(QueryEngineTest, BackwardCallGraph) {
    QueryEngine engine(storage_);
    auto response = engine.getBackwardCallGraph("u:helper", 3);

    // helper <- process <- compute <- main
    EXPECT_GE(response.nodes_size(), 4);
}

TEST_F(QueryEngineTest, FindPath) {
    QueryEngine engine(storage_);
    auto response = engine.findPath("u:main", "u:helper");

    // main -> compute -> process -> helper
    ASSERT_GE(response.nodes_size(), 4);
    EXPECT_GE(response.edges_size(), 3);
}

TEST_F(QueryEngineTest, FindPath_NoPath) {
    QueryEngine engine(storage_);
    auto response = engine.findPath("u:helper", "u:main");

    // No backward path in forward search
    EXPECT_EQ(response.nodes_size(), 0);
}

TEST_F(QueryEngineTest, CacheWorks) {
    QueryEngine engine(storage_, 10);

    engine.getFunctionInfo("u:main");
    EXPECT_EQ(engine.getCacheSize(), 1);

    engine.getFunctionInfo("u:compute");
    EXPECT_EQ(engine.getCacheSize(), 2);

    // Re-access should not increase size
    engine.getFunctionInfo("u:main");
    EXPECT_EQ(engine.getCacheSize(), 2);
}
