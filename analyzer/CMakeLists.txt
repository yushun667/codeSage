cmake_minimum_required(VERSION 3.20)
project(CodeSageAnalyzer C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# LLVM pre-built binaries are compiled without RTTI
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fno-rtti")

set(THIRD_PARTY_DIR "${CMAKE_SOURCE_DIR}/../third_party")
set(PROTO_DIR "${CMAKE_SOURCE_DIR}/../proto")

# ---------- LLVM / Clang ----------
set(LLVM_DIR "${THIRD_PARTY_DIR}/llvm/lib/cmake/llvm")
set(Clang_DIR "${THIRD_PARTY_DIR}/llvm/lib/cmake/clang")

find_package(LLVM REQUIRED CONFIG)
find_package(Clang REQUIRED CONFIG)

message(STATUS "Found LLVM ${LLVM_PACKAGE_VERSION}")
message(STATUS "Using LLVMConfig.cmake in: ${LLVM_DIR}")

include_directories(${LLVM_INCLUDE_DIRS})
add_definitions(${LLVM_DEFINITIONS})

# ---------- RocksDB ----------
set(ROCKSDB_ROOT "${THIRD_PARTY_DIR}/rocksdb")
set(ROCKSDB_INCLUDE "${ROCKSDB_ROOT}/include")
set(ROCKSDB_LIB "${ROCKSDB_ROOT}/build/librocksdb.a")

if(NOT EXISTS "${ROCKSDB_LIB}")
    message(FATAL_ERROR "RocksDB not found at ${ROCKSDB_LIB}. Run third_party/scripts/setup_deps.sh first.")
endif()

# ---------- Protobuf ----------
set(PROTOBUF_ROOT "${THIRD_PARTY_DIR}/protobuf")
set(PROTOBUF_BUILD "${PROTOBUF_ROOT}/build")

find_program(PROTOC_EXECUTABLE protoc
    PATHS "${PROTOBUF_BUILD}" "${PROTOBUF_BUILD}/bin"
    NO_DEFAULT_PATH)

if(NOT PROTOC_EXECUTABLE)
    find_program(PROTOC_EXECUTABLE protoc)
endif()

if(NOT PROTOC_EXECUTABLE)
    message(FATAL_ERROR "protoc not found. Run third_party/scripts/setup_deps.sh first.")
endif()

message(STATUS "Using protoc: ${PROTOC_EXECUTABLE}")

# Detect system protobuf include path (homebrew)
if(EXISTS "/opt/homebrew/include/google/protobuf/message.h")
    set(PROTOBUF_SYS_INCLUDE "/opt/homebrew/include")
    message(STATUS "Found system protobuf headers at ${PROTOBUF_SYS_INCLUDE}")
endif()

set(GENERATED_DIR "${CMAKE_SOURCE_DIR}/src/generated")
file(MAKE_DIRECTORY "${GENERATED_DIR}")

set(PROTO_SRC "${GENERATED_DIR}/codesage.pb.cc")
set(PROTO_HDR "${GENERATED_DIR}/codesage.pb.h")

add_custom_command(
    OUTPUT "${PROTO_SRC}" "${PROTO_HDR}"
    COMMAND "${PROTOC_EXECUTABLE}"
        --proto_path="${PROTO_DIR}"
        --cpp_out="${GENERATED_DIR}"
        "${PROTO_DIR}/codesage.proto"
    DEPENDS "${PROTO_DIR}/codesage.proto"
    COMMENT "Generating protobuf C++ files"
)

# ---------- spdlog ----------
set(SPDLOG_INCLUDE "${THIRD_PARTY_DIR}/spdlog/include")

# ---------- nlohmann/json ----------
set(JSON_INCLUDE "${THIRD_PARTY_DIR}/nlohmann")

# ---------- Source files ----------
set(SOURCES
    src/main.cpp
    src/logger.cpp
    src/storage.cpp
    src/ast_consumer.cpp
    src/function_collector.cpp
    src/variable_collector.cpp
    src/dataflow_analyzer.cpp
    src/query_engine.cpp
    src/json_output.cpp
    ${PROTO_SRC}
)

add_executable(code-sage ${SOURCES})

target_include_directories(code-sage PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${GENERATED_DIR}
    ${ROCKSDB_INCLUDE}
    ${SPDLOG_INCLUDE}
    ${JSON_INCLUDE}
    ${LLVM_INCLUDE_DIRS}
    ${CLANG_INCLUDE_DIRS}
    ${PROTOBUF_SYS_INCLUDE}
)

# Find protobuf libraries: first in third_party, then system
find_library(PROTOBUF_LIBRARY protobuf
    PATHS "${PROTOBUF_BUILD}/lib" "${PROTOBUF_BUILD}"
    NO_DEFAULT_PATH)

if(NOT PROTOBUF_LIBRARY)
    find_library(PROTOBUF_LIBRARY protobuf
        PATHS "/opt/homebrew/lib" "/usr/local/lib" "/usr/lib")
endif()

if(NOT PROTOBUF_LIBRARY)
    message(FATAL_ERROR "libprotobuf not found")
endif()

message(STATUS "Using protobuf library: ${PROTOBUF_LIBRARY}")

# Find absl libraries needed by protobuf v25+
file(GLOB ABSL_LIBS
    "${PROTOBUF_BUILD}/lib/libabsl_*.a"
    "${PROTOBUF_BUILD}/third_party/abseil-cpp/absl/*/libabsl_*.a"
    "/opt/homebrew/lib/libabsl_*.dylib"
)
find_library(UTF8_RANGE_LIB utf8_range
    PATHS "${PROTOBUF_BUILD}/lib" "${PROTOBUF_BUILD}" "/opt/homebrew/lib"
    NO_DEFAULT_PATH)
find_library(UTF8_VALIDITY_LIB utf8_validity
    PATHS "${PROTOBUF_BUILD}/lib" "${PROTOBUF_BUILD}" "/opt/homebrew/lib"
    NO_DEFAULT_PATH)
if(NOT UTF8_RANGE_LIB)
    find_library(UTF8_RANGE_LIB utf8_range)
endif()
if(NOT UTF8_VALIDITY_LIB)
    find_library(UTF8_VALIDITY_LIB utf8_validity)
endif()

# Clang libraries for LibTooling
set(CLANG_LIBS
    clangTooling
    clangFrontend
    clangSerialization
    clangDriver
    clangParse
    clangSema
    clangAnalysis
    clangAST
    clangASTMatchers
    clangIndex
    clangEdit
    clangLex
    clangBasic
    clangRewrite
)

llvm_map_components_to_libnames(LLVM_LIBS
    core
    support
    option
    frontendopenacc
    frontendhlsl
    targetparser
)

target_link_libraries(code-sage PRIVATE
    ${CLANG_LIBS}
    ${LLVM_LIBS}
    ${ROCKSDB_LIB}
    ${PROTOBUF_LIBRARY}
    ${UTF8_RANGE_LIB}
    ${UTF8_VALIDITY_LIB}
    ${ABSL_LIBS}
    pthread
    z
)

if(APPLE)
    find_library(COREFOUNDATION_LIB CoreFoundation)
    find_library(SECURITY_LIB Security)
    target_link_libraries(code-sage PRIVATE
        ${COREFOUNDATION_LIB}
        ${SECURITY_LIB}
        "-framework IOKit"
    )
endif()

# ---------- Tests ----------
option(BUILD_TESTS "Build tests" ON)

if(BUILD_TESTS)
    set(GTEST_ROOT "${THIRD_PARTY_DIR}/googletest")
    set(GTEST_INCLUDE "${GTEST_ROOT}/googletest/include")
    set(GTEST_LIB_DIR "${GTEST_ROOT}/build/lib")

    enable_testing()

    function(add_codesage_test TEST_NAME TEST_SRC)
        add_executable(${TEST_NAME} ${TEST_SRC}
            src/logger.cpp
            src/storage.cpp
            src/query_engine.cpp
            src/dataflow_analyzer.cpp
            src/json_output.cpp
            src/function_collector.cpp
            src/variable_collector.cpp
            src/ast_consumer.cpp
            ${PROTO_SRC}
        )
        target_include_directories(${TEST_NAME} PRIVATE
            ${CMAKE_SOURCE_DIR}/src
            ${GENERATED_DIR}
            ${GTEST_INCLUDE}
            ${ROCKSDB_INCLUDE}
            ${SPDLOG_INCLUDE}
            ${JSON_INCLUDE}
            ${LLVM_INCLUDE_DIRS}
            ${CLANG_INCLUDE_DIRS}
            ${PROTOBUF_SYS_INCLUDE}
        )

        find_library(GTEST_LIB gtest PATHS "${GTEST_LIB_DIR}" NO_DEFAULT_PATH)
        find_library(GTEST_MAIN_LIB gtest_main PATHS "${GTEST_LIB_DIR}" NO_DEFAULT_PATH)

        target_link_libraries(${TEST_NAME} PRIVATE
            ${GTEST_LIB}
            ${GTEST_MAIN_LIB}
            ${CLANG_LIBS}
            ${LLVM_LIBS}
            ${ROCKSDB_LIB}
            ${PROTOBUF_LIBRARY}
            ${UTF8_RANGE_LIB}
            ${UTF8_VALIDITY_LIB}
            ${ABSL_LIBS}
            pthread
            z
        )
        if(APPLE)
            target_link_libraries(${TEST_NAME} PRIVATE
                ${COREFOUNDATION_LIB}
                ${SECURITY_LIB}
                "-framework IOKit"
            )
        endif()
        add_test(NAME ${TEST_NAME} COMMAND ${TEST_NAME})
    endfunction()

    add_codesage_test(test_storage test/test_storage.cpp)
    add_codesage_test(test_analyzer test/test_analyzer.cpp)
    add_codesage_test(test_query test/test_query.cpp)
    add_codesage_test(test_dataflow test/test_dataflow.cpp)
endif()
