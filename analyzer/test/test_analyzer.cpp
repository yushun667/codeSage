#include <gtest/gtest.h>
#include <filesystem>
#include <fstream>

#include "storage.h"
#include "ast_consumer.h"
#include "json_output.h"
#include "logger.h"

namespace fs = std::filesystem;
using namespace codesage;

class AnalyzerTest : public ::testing::Test {
protected:
    void SetUp() override {
        Logger::init("", spdlog::level::warn);
        test_dir_ = fs::temp_directory_path() / "codesage_analyzer_test";
        test_db_path_ = test_dir_ / "test_db";
        fs::remove_all(test_dir_);
        fs::create_directories(test_dir_);

        createTestProject();
        ASSERT_TRUE(storage_.open(test_db_path_.string()));
    }

    void TearDown() override {
        storage_.close();
        fs::remove_all(test_dir_);
        Logger::shutdown();
    }

    void createTestProject() {
        // Create simple C files
        auto src_dir = test_dir_ / "src";
        fs::create_directories(src_dir);

        // main.c
        {
            std::ofstream f(src_dir / "main.c");
            f << "int global_x = 0;\n"
              << "void bar(void);\n"
              << "void foo(void) { global_x = 1; bar(); }\n"
              << "void bar(void) { global_x++; }\n"
              << "int main(void) { foo(); return global_x; }\n";
        }

        // compile_commands.json
        {
            std::ofstream f(test_dir_ / "compile_commands.json");
            f << "[\n"
              << "  {\n"
              << "    \"directory\": \"" << test_dir_.string() << "\",\n"
              << "    \"command\": \"cc -c " << (src_dir / "main.c").string() << "\",\n"
              << "    \"file\": \"" << (src_dir / "main.c").string() << "\"\n"
              << "  }\n"
              << "]\n";
        }

        compile_db_path_ = test_dir_ / "compile_commands.json";
    }

    Storage storage_;
    fs::path test_dir_;
    fs::path test_db_path_;
    fs::path compile_db_path_;
};

TEST_F(AnalyzerTest, JsonOutputFunctions) {
    FunctionInfo func;
    func.set_usr("c:@F@main");
    func.set_name("main");
    func.set_file("main.c");
    func.set_line(5);
    func.set_column(1);
    func.set_module("root");
    func.set_signature("int main(void)");

    auto j = functionToJson(func);
    EXPECT_EQ(j["name"], "main");
    EXPECT_EQ(j["file"], "main.c");
    EXPECT_EQ(j["line"], 5);
}

TEST_F(AnalyzerTest, JsonOutputCallEdge) {
    CallEdge edge;
    edge.set_caller_usr("c:@F@main");
    edge.set_callee_usr("c:@F@foo");
    edge.set_call_file("main.c");
    edge.set_call_line(5);

    auto j = callEdgeToJson(edge);
    EXPECT_EQ(j["caller_usr"], "c:@F@main");
    EXPECT_EQ(j["callee_usr"], "c:@F@foo");
}

TEST_F(AnalyzerTest, JsonOutputGlobalVar) {
    GlobalVarInfo var;
    var.set_usr("c:@global_x");
    var.set_name("global_x");
    var.set_file("main.c");
    var.set_line(1);
    var.set_type("int");
    var.set_is_extern(false);

    auto j = globalVarToJson(var);
    EXPECT_EQ(j["name"], "global_x");
    EXPECT_EQ(j["type"], "int");
    EXPECT_EQ(j["is_extern"], false);
}

TEST_F(AnalyzerTest, JsonOutputCallGraph) {
    CallGraphResponse response;
    auto* n = response.add_nodes();
    n->set_usr("u1"); n->set_name("f1");
    n->set_file("a.c"); n->set_line(1);

    auto* e = response.add_edges();
    e->set_caller_usr("u1"); e->set_callee_usr("u2");

    auto j = callGraphResponseToJson(response);
    EXPECT_EQ(j["nodes"].size(), 1);
    EXPECT_EQ(j["edges"].size(), 1);
}
