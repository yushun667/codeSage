#include <gtest/gtest.h>
#include <filesystem>
#include <fstream>

#include "storage.h"
#include "ast_consumer.h"
#include "dataflow_analyzer.h"
#include "logger.h"

namespace fs = std::filesystem;
using namespace codesage;

class FuncPtrTest : public ::testing::Test {
protected:
    void SetUp() override {
        Logger::init("", spdlog::level::info);
        test_dir_ = fs::temp_directory_path() / "codesage_funcptr_test";
        test_db_path_ = test_dir_ / "test_db";
        fs::remove_all(test_dir_);
        fs::create_directories(test_dir_);
        ASSERT_TRUE(storage_.open(test_db_path_.string()));
    }

    void TearDown() override {
        storage_.close();
        fs::remove_all(test_dir_);
        Logger::shutdown();
    }

    void writeSource(const std::string& filename, const std::string& content) {
        auto src_dir = test_dir_ / "src";
        fs::create_directories(src_dir);
        std::ofstream f(src_dir / filename);
        f << content;
    }

    void writeCompileDB(const std::string& filename) {
        auto src_file = test_dir_ / "src" / filename;
        std::ofstream f(test_dir_ / "compile_commands.json");
        f << "[\n"
          << "  {\n"
          << "    \"directory\": \"" << test_dir_.string() << "\",\n"
          << "    \"command\": \"cc -std=c11 -c " << src_file.string() << "\",\n"
          << "    \"file\": \"" << src_file.string() << "\"\n"
          << "  }\n"
          << "]\n";
    }

    void writeCompileDBCpp(const std::string& filename) {
        auto src_file = test_dir_ / "src" / filename;
        std::ofstream f(test_dir_ / "compile_commands.json");
        f << "[\n"
          << "  {\n"
          << "    \"directory\": \"" << test_dir_.string() << "\",\n"
          << "    \"command\": \"c++ -std=c++17 -c " << src_file.string() << "\",\n"
          << "    \"file\": \"" << src_file.string() << "\"\n"
          << "  }\n"
          << "]\n";
    }

    AnalyzerStats runAnalyzer() {
        AnalyzerConfig config;
        config.compile_db_path = (test_dir_ / "compile_commands.json").string();
        config.db_path = test_db_path_.string();
        config.project_root = test_dir_.string();
        config.core_modules = {};
        SourceAnalyzer analyzer(storage_, config);
        return analyzer.parseAll();
    }

    bool hasEdge(const std::string& caller_name, const std::string& callee_name,
                 const std::string& expected_type = "") {
        std::string caller_usr, callee_usr;
        storage_.iterateWithPrefix("func:", [&](const std::string&, const std::string& value) -> bool {
            FunctionInfo func;
            if (!func.ParseFromString(value)) return true;
            if (func.name() == caller_name) caller_usr = func.usr();
            if (func.name() == callee_name) callee_usr = func.usr();
            return true;
        });
        if (caller_usr.empty() || callee_usr.empty()) return false;

        auto edges = storage_.getForwardEdges(caller_usr);
        for (const auto& edge : edges) {
            if (edge.callee_usr() == callee_usr) {
                if (expected_type.empty()) return true;
                return edge.edge_type() == expected_type;
            }
        }
        return false;
    }

    Storage storage_;
    fs::path test_dir_;
    fs::path test_db_path_;
};

// Pattern 1: function pointer variable assignment + call
TEST_F(FuncPtrTest, LocalFuncPtrAssignment) {
    writeSource("fp_local.c",
        "void target_func(int x) {}\n"
        "void caller(void) {\n"
        "    void (*fp)(int) = target_func;\n"
        "    fp(42);\n"
        "}\n"
    );
    writeCompileDB("fp_local.c");
    runAnalyzer();

    EXPECT_TRUE(hasEdge("caller", "target_func", "indirect"))
        << "Should detect indirect call via local function pointer variable";
}

// Pattern 2: callback parameter passing
TEST_F(FuncPtrTest, CallbackParameterPassing) {
    writeSource("fp_callback.c",
        "void my_handler(int x) {}\n"
        "void register_handler(void (*handler)(int)) {\n"
        "    handler(0);\n"
        "}\n"
        "void setup(void) {\n"
        "    register_handler(my_handler);\n"
        "}\n"
    );
    writeCompileDB("fp_callback.c");
    runAnalyzer();

    EXPECT_TRUE(hasEdge("setup", "register_handler", "direct"))
        << "Should detect direct call from setup to register_handler";

    auto passes = storage_.getAllCallbackPasses();
    bool found_pass = false;
    for (const auto& p : passes) {
        if (p.param_index() == 0) {
            found_pass = true;
        }
    }
    EXPECT_TRUE(found_pass)
        << "Should record callback pass of my_handler to register_handler param 0";

    DataFlowAnalyzer dfa(storage_);
    dfa.resolveCallbackEdges();

    EXPECT_TRUE(hasEdge("register_handler", "my_handler", "callback"))
        << "Should resolve callback edge: register_handler -> my_handler";
}

// Pattern 3: function pointer reassignment
TEST_F(FuncPtrTest, FuncPtrReassignment) {
    writeSource("fp_reassign.c",
        "void func_a(void) {}\n"
        "void func_b(void) {}\n"
        "void caller(int cond) {\n"
        "    void (*fp)(void) = func_a;\n"
        "    if (cond) fp = func_b;\n"
        "    fp();\n"
        "}\n"
    );
    writeCompileDB("fp_reassign.c");
    runAnalyzer();

    EXPECT_TRUE(hasEdge("caller", "func_a", "indirect"))
        << "Should detect indirect call to func_a via fp";
    EXPECT_TRUE(hasEdge("caller", "func_b", "indirect"))
        << "Should detect indirect call to func_b via fp reassignment";
}

// Pattern 4: typedef/using function pointer
TEST_F(FuncPtrTest, TypedefFuncPtr) {
    writeSource("fp_typedef.c",
        "typedef void (*Callback)(int);\n"
        "void process(int x) {}\n"
        "void caller(void) {\n"
        "    Callback cb = process;\n"
        "    cb(42);\n"
        "}\n"
    );
    writeCompileDB("fp_typedef.c");
    runAnalyzer();

    EXPECT_TRUE(hasEdge("caller", "process", "indirect"))
        << "Should detect indirect call via typedef'd function pointer";
}

// Direct call edge_type should be "direct"
TEST_F(FuncPtrTest, DirectCallEdgeType) {
    writeSource("fp_direct.c",
        "void callee(void) {}\n"
        "void caller(void) { callee(); }\n"
    );
    writeCompileDB("fp_direct.c");
    runAnalyzer();

    EXPECT_TRUE(hasEdge("caller", "callee", "direct"))
        << "Direct calls should have edge_type='direct'";
}

// Storage: CallbackPass round-trip
TEST_F(FuncPtrTest, CallbackPassStorage) {
    CallbackPass pass;
    pass.set_caller_usr("c:@F@setup");
    pass.set_callee_usr("c:@F@register");
    pass.set_param_index(0);
    pass.set_callback_usr("c:@F@handler");
    pass.set_call_file("test.c");
    pass.set_call_line(10);

    ASSERT_TRUE(storage_.putCallbackPass(pass));

    auto passes = storage_.getCallbackPassesByCallee("c:@F@register");
    ASSERT_EQ(passes.size(), 1u);
    EXPECT_EQ(passes[0].caller_usr(), "c:@F@setup");
    EXPECT_EQ(passes[0].callback_usr(), "c:@F@handler");
    EXPECT_EQ(passes[0].param_index(), 0);
}
