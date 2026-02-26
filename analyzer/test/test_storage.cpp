#include <gtest/gtest.h>
#include <filesystem>

#include "storage.h"
#include "logger.h"

namespace fs = std::filesystem;
using namespace codesage;

class StorageTest : public ::testing::Test {
protected:
    void SetUp() override {
        Logger::init("", spdlog::level::warn);
        test_db_path_ = fs::temp_directory_path() / "codesage_test_db";
        fs::remove_all(test_db_path_);
        ASSERT_TRUE(storage_.open(test_db_path_.string()));
    }

    void TearDown() override {
        storage_.close();
        fs::remove_all(test_db_path_);
        Logger::shutdown();
    }

    Storage storage_;
    fs::path test_db_path_;
};

TEST_F(StorageTest, OpenAndClose) {
    EXPECT_TRUE(storage_.isOpen());
    storage_.close();
    EXPECT_FALSE(storage_.isOpen());
}

TEST_F(StorageTest, PutAndGetFunction) {
    FunctionInfo func;
    func.set_usr("c:@F@main");
    func.set_name("main");
    func.set_file("/test/main.c");
    func.set_line(10);
    func.set_column(1);
    func.set_module("root");
    func.set_signature("int main(int argc, char **argv)");

    ASSERT_TRUE(storage_.putFunction(func));

    auto retrieved = storage_.getFunction("c:@F@main");
    ASSERT_TRUE(retrieved.has_value());
    EXPECT_EQ(retrieved->name(), "main");
    EXPECT_EQ(retrieved->file(), "/test/main.c");
    EXPECT_EQ(retrieved->line(), 10);
    EXPECT_EQ(retrieved->module(), "root");
}

TEST_F(StorageTest, SearchFunctions) {
    FunctionInfo f1;
    f1.set_usr("c:@F@process_data"); f1.set_name("process_data");
    f1.set_file("a.c"); f1.set_line(1); f1.set_module("core");

    FunctionInfo f2;
    f2.set_usr("c:@F@process_input"); f2.set_name("process_input");
    f2.set_file("b.c"); f2.set_line(1); f2.set_module("io");

    FunctionInfo f3;
    f3.set_usr("c:@F@init"); f3.set_name("init");
    f3.set_file("c.c"); f3.set_line(1); f3.set_module("core");

    storage_.putFunction(f1);
    storage_.putFunction(f2);
    storage_.putFunction(f3);

    auto results = storage_.searchFunctions("process", 10);
    EXPECT_EQ(results.size(), 2);

    auto results2 = storage_.searchFunctions("init", 10);
    EXPECT_EQ(results2.size(), 1);
    EXPECT_EQ(results2[0].name(), "init");
}

TEST_F(StorageTest, CallEdges) {
    CallEdge edge;
    edge.set_caller_usr("c:@F@main");
    edge.set_callee_usr("c:@F@process_data");
    edge.set_call_file("main.c");
    edge.set_call_line(15);

    ASSERT_TRUE(storage_.putCallEdge(edge));

    auto fwd = storage_.getForwardEdges("c:@F@main");
    ASSERT_EQ(fwd.size(), 1);
    EXPECT_EQ(fwd[0].callee_usr(), "c:@F@process_data");

    auto bwd = storage_.getBackwardEdges("c:@F@process_data");
    ASSERT_EQ(bwd.size(), 1);
    EXPECT_EQ(bwd[0].caller_usr(), "c:@F@main");
}

TEST_F(StorageTest, GlobalVariables) {
    GlobalVarInfo var;
    var.set_usr("c:@global_counter");
    var.set_name("global_counter");
    var.set_file("main.c");
    var.set_line(3);
    var.set_type("int");
    var.set_is_extern(false);
    var.set_module("root");

    ASSERT_TRUE(storage_.putGlobalVar(var));

    auto retrieved = storage_.getGlobalVar("c:@global_counter");
    ASSERT_TRUE(retrieved.has_value());
    EXPECT_EQ(retrieved->name(), "global_counter");
    EXPECT_EQ(retrieved->type(), "int");
}

TEST_F(StorageTest, VariableAccesses) {
    GlobalVarAccess access;
    access.set_var_usr("c:@global_counter");
    access.set_function_usr("c:@F@process_data");
    access.set_is_write(true);
    access.set_access_file("main.c");
    access.set_access_line(10);

    ASSERT_TRUE(storage_.putAccess(access));

    auto by_func = storage_.getAccessesByFunction("c:@F@process_data");
    ASSERT_EQ(by_func.size(), 1);
    EXPECT_TRUE(by_func[0].is_write());

    auto by_var = storage_.getAccessesByVariable("c:@global_counter");
    ASSERT_EQ(by_var.size(), 1);
    EXPECT_EQ(by_var[0].function_usr(), "c:@F@process_data");
}

TEST_F(StorageTest, ParsedFileTracking) {
    EXPECT_FALSE(storage_.isFileParsed("/test/a.c"));

    storage_.markFileParsed("/test/a.c");
    EXPECT_TRUE(storage_.isFileParsed("/test/a.c"));
    EXPECT_FALSE(storage_.isFileParsed("/test/b.c"));

    auto files = storage_.getParsedFiles();
    EXPECT_EQ(files.size(), 1);
    EXPECT_EQ(files[0], "/test/a.c");
}

TEST_F(StorageTest, CountStats) {
    FunctionInfo f;
    f.set_usr("u1"); f.set_name("f1"); f.set_file("a.c"); f.set_line(1);
    storage_.putFunction(f);
    f.set_usr("u2"); f.set_name("f2");
    storage_.putFunction(f);

    EXPECT_EQ(storage_.countFunctions(), 2);

    CallEdge e;
    e.set_caller_usr("u1"); e.set_callee_usr("u2");
    storage_.putCallEdge(e);

    EXPECT_EQ(storage_.countEdges(), 1);
}
