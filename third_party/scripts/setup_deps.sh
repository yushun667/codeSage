#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THIRD_PARTY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
JOBS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

log() { echo "[setup_deps] $(date '+%H:%M:%S') $*"; }
err() { echo "[setup_deps] ERROR: $*" >&2; exit 1; }

detect_platform() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"
    case "$os" in
        Darwin) OS="macos" ;;
        Linux)  OS="linux" ;;
        *)      err "Unsupported OS: $os" ;;
    esac
    case "$arch" in
        arm64|aarch64) ARCH="arm64" ;;
        x86_64)        ARCH="x86_64" ;;
        *)             err "Unsupported arch: $arch" ;;
    esac
    log "Platform: $OS-$ARCH, using $JOBS parallel jobs"
}

setup_llvm() {
    local llvm_dir="$THIRD_PARTY_DIR/llvm"
    if [ -d "$llvm_dir/bin/clang" ] || [ -f "$llvm_dir/bin/clang" ]; then
        log "LLVM already installed, skipping"
        return
    fi

    log "Downloading LLVM 18.1.8 pre-built binaries..."
    local llvm_ver="18.1.8"
    local url=""
    local archive=""

    if [ "$OS" = "macos" ] && [ "$ARCH" = "arm64" ]; then
        archive="clang+llvm-${llvm_ver}-arm64-apple-macos11.tar.xz"
        url="https://github.com/llvm/llvm-project/releases/download/llvmorg-${llvm_ver}/${archive}"
    elif [ "$OS" = "linux" ] && [ "$ARCH" = "x86_64" ]; then
        archive="clang+llvm-${llvm_ver}-x86_64-linux-gnu-ubuntu-18.04.tar.xz"
        url="https://github.com/llvm/llvm-project/releases/download/llvmorg-${llvm_ver}/${archive}"
    else
        err "No pre-built LLVM binary for $OS-$ARCH. Please install LLVM manually."
    fi

    cd "$THIRD_PARTY_DIR"
    if [ ! -f "$archive" ]; then
        curl -L -o "$archive" "$url" || err "Failed to download LLVM"
    fi

    log "Extracting LLVM..."
    mkdir -p llvm_tmp
    tar xf "$archive" -C llvm_tmp --strip-components=1
    mv llvm_tmp llvm
    rm -f "$archive"
    log "LLVM installed to $llvm_dir"
}

setup_rocksdb() {
    local rocksdb_dir="$THIRD_PARTY_DIR/rocksdb"
    if [ -f "$rocksdb_dir/build/librocksdb.a" ]; then
        log "RocksDB already built, skipping"
        return
    fi

    log "Cloning RocksDB v9.8.4..."
    cd "$THIRD_PARTY_DIR"
    if [ ! -d "rocksdb" ]; then
        git clone --depth 1 --branch v9.8.4 https://github.com/facebook/rocksdb.git
    fi

    log "Building RocksDB..."
    cd rocksdb
    mkdir -p build && cd build
    cmake .. \
        -DCMAKE_BUILD_TYPE=Release \
        -DWITH_TESTS=OFF \
        -DWITH_BENCHMARK_TOOLS=OFF \
        -DWITH_TOOLS=OFF \
        -DWITH_GFLAGS=OFF \
        -DROCKSDB_BUILD_SHARED=OFF \
        -DFAIL_ON_WARNINGS=OFF
    cmake --build . -j"$JOBS" --target rocksdb
    log "RocksDB built successfully"
}

setup_protobuf() {
    local proto_dir="$THIRD_PARTY_DIR/protobuf"
    if [ -f "$proto_dir/build/protoc" ] || [ -f "$proto_dir/build/bin/protoc" ]; then
        log "Protobuf already built, skipping"
        return
    fi

    log "Cloning Protobuf v25.6..."
    cd "$THIRD_PARTY_DIR"
    if [ ! -d "protobuf" ]; then
        git clone --depth 1 --branch v25.6 --recurse-submodules https://github.com/protocolbuffers/protobuf.git
    fi

    log "Building Protobuf..."
    cd protobuf
    mkdir -p build && cd build
    cmake .. \
        -DCMAKE_BUILD_TYPE=Release \
        -Dprotobuf_BUILD_TESTS=OFF \
        -Dprotobuf_BUILD_EXAMPLES=OFF \
        -DABSL_PROPAGATE_CXX_STD=ON \
        -DCMAKE_CXX_STANDARD=17
    cmake --build . -j"$JOBS"
    log "Protobuf built successfully"
}

setup_spdlog() {
    local spdlog_dir="$THIRD_PARTY_DIR/spdlog"
    if [ -d "$spdlog_dir/include/spdlog" ]; then
        log "spdlog already present, skipping"
        return
    fi

    log "Cloning spdlog v1.15.2 (header-only)..."
    cd "$THIRD_PARTY_DIR"
    git clone --depth 1 --branch v1.15.2 https://github.com/gabime/spdlog.git
    log "spdlog ready (header-only)"
}

setup_json() {
    local json_dir="$THIRD_PARTY_DIR/nlohmann"
    if [ -f "$json_dir/json.hpp" ]; then
        log "nlohmann/json already present, skipping"
        return
    fi

    log "Downloading nlohmann/json single header..."
    mkdir -p "$json_dir"
    curl -L -o "$json_dir/json.hpp" \
        "https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp"
    log "nlohmann/json ready"
}

setup_googletest() {
    local gtest_dir="$THIRD_PARTY_DIR/googletest"
    if [ -d "$gtest_dir/build/lib" ] && [ "$(ls -A "$gtest_dir/build/lib/" 2>/dev/null)" ]; then
        log "GoogleTest already built, skipping"
        return
    fi

    log "Cloning GoogleTest v1.15.2..."
    cd "$THIRD_PARTY_DIR"
    if [ ! -d "googletest" ]; then
        git clone --depth 1 --branch v1.15.2 https://github.com/google/googletest.git
    fi

    log "Building GoogleTest..."
    cd googletest
    mkdir -p build && cd build
    cmake .. -DCMAKE_BUILD_TYPE=Release
    cmake --build . -j"$JOBS"
    log "GoogleTest built successfully"
}

main() {
    log "=== CodeSage Third-Party Dependencies Setup ==="
    detect_platform

    setup_llvm
    setup_rocksdb
    setup_protobuf
    setup_spdlog
    setup_json
    setup_googletest

    log "=== All dependencies ready ==="
    log "LLVM:       $THIRD_PARTY_DIR/llvm"
    log "RocksDB:    $THIRD_PARTY_DIR/rocksdb"
    log "Protobuf:   $THIRD_PARTY_DIR/protobuf"
    log "spdlog:     $THIRD_PARTY_DIR/spdlog"
    log "json:       $THIRD_PARTY_DIR/nlohmann"
    log "GoogleTest: $THIRD_PARTY_DIR/googletest"
}

main "$@"
