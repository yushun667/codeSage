#include <gtest/gtest.h>
#include <filesystem>

#include "storage.h"
#include "dataflow_analyzer.h"
#include "logger.h"

namespace fs = std::filesystem;
using namespace codesage;

class DataFlowTest : public ::testing::Test {
protected:
    void SetUp() override {
        Logger::init("", spdlog::level::warn);
        test_db_path_ = fs::temp_directory_path() / "codesage_dataflow_test_db";
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
        // Call chain: main -> compute -> process -> helper
        //             main -> compute -> read_config
        auto addFunc = [&](const std::string& usr, const std::string& name) {
            FunctionInfo f;
            f.set_usr(usr); f.set_name(name);
            f.set_file("test.c"); f.set_line(1); f.set_module("root");
            storage_.putFunction(f);
        };

        addFunc("u:main", "main");
        addFunc("u:compute", "compute_result");
        addFunc("u:process", "process_data");
        addFunc("u:helper", "helper_function");
        addFunc("u:read_cfg", "read_config");

        auto addEdge = [&](const std::string& caller, const std::string& callee) {
            CallEdge e;
            e.set_caller_usr(caller); e.set_callee_usr(callee);
            storage_.putCallEdge(e);
        };

        addEdge("u:main", "u:compute");
        addEdge("u:compute", "u:read_cfg");
        addEdge("u:compute", "u:process");
        addEdge("u:process", "u:helper");

        // Variable: global_counter
        GlobalVarInfo var;
        var.set_usr("v:counter"); var.set_name("global_counter");
        var.set_file("test.c"); var.set_line(3); var.set_type("int");
        storage_.putGlobalVar(var);

        // Variable: global_config
        GlobalVarInfo var2;
        var2.set_usr("v:config"); var2.set_name("global_config");
        var2.set_file("test.c"); var2.set_line(4); var2.set_type("int");
        storage_.putGlobalVar(var2);

        // Direct accesses:
        // process_data writes global_counter
        // helper_function writes global_counter
        // read_config reads global_config
        auto addAccess = [&](const std::string& func, const std::string& var,
                             bool is_write) {
            GlobalVarAccess a;
            a.set_function_usr(func); a.set_var_usr(var);
            a.set_is_write(is_write);
            a.set_access_file("test.c"); a.set_access_line(10);
            storage_.putAccess(a);
        };

        addAccess("u:process", "v:counter", true);
        addAccess("u:helper", "v:counter", true);
        addAccess("u:read_cfg", "v:config", false);
    }

    Storage storage_;
    fs::path test_db_path_;
};

TEST_F(DataFlowTest, ComputeSideEffects) {
    DataFlowAnalyzer analyzer(storage_);
    analyzer.computeSideEffects();

    const auto& summaries = analyzer.getSummaries();

    // process directly modifies counter
    EXPECT_TRUE(summaries.at("u:process").modifies.count("v:counter"));

    // compute indirectly modifies counter (via process -> helper)
    EXPECT_TRUE(summaries.at("u:compute").modifies.count("v:counter"));

    // main indirectly modifies counter
    EXPECT_TRUE(summaries.at("u:main").modifies.count("v:counter"));

    // compute reads config (via read_config)
    EXPECT_TRUE(summaries.at("u:compute").references.count("v:config"));

    // main reads config (via compute -> read_config)
    EXPECT_TRUE(summaries.at("u:main").references.count("v:config"));

    // helper does not read config
    EXPECT_FALSE(summaries.at("u:helper").references.count("v:config"));
}

TEST_F(DataFlowTest, FindModifiers) {
    DataFlowAnalyzer analyzer(storage_);
    analyzer.computeSideEffects();

    auto modifiers = analyzer.findModifiers("v:counter");
    // process, helper, compute, main should all be modifiers
    EXPECT_GE(modifiers.size(), 4);
}

TEST_F(DataFlowTest, FindReaders) {
    DataFlowAnalyzer analyzer(storage_);
    analyzer.computeSideEffects();

    auto readers = analyzer.findReaders("v:config");
    // read_config, compute, main
    EXPECT_GE(readers.size(), 3);
}

TEST_F(DataFlowTest, BuildVariableDataFlow) {
    DataFlowAnalyzer analyzer(storage_);
    analyzer.computeSideEffects();

    auto response = analyzer.buildVariableDataFlow("v:counter", 3);

    EXPECT_GE(response.function_nodes_size(), 2); // at least process and helper
    EXPECT_EQ(response.variable_nodes_size(), 1); // global_counter
    EXPECT_GE(response.edges_size(), 2); // direct writes + call edges
}

TEST_F(DataFlowTest, PersistSummaries) {
    DataFlowAnalyzer analyzer(storage_);
    analyzer.computeSideEffects();
    analyzer.persistSummaries();

    // Verify persisted data
    auto func = storage_.getFunction("u:compute");
    ASSERT_TRUE(func.has_value());

    bool found_counter_mod = false;
    for (const auto& m : func->modifies()) {
        if (m == "v:counter") found_counter_mod = true;
    }
    EXPECT_TRUE(found_counter_mod);

    bool found_config_ref = false;
    for (const auto& r : func->references()) {
        if (r == "v:config") found_config_ref = true;
    }
    EXPECT_TRUE(found_config_ref);
}
