# setup_deps_win.ps1 — Install CodeSage third-party dependencies on Windows (MSVC)
# Requires: Visual Studio Build Tools, CMake, Git, curl
# Usage: powershell -ExecutionPolicy Bypass -File setup_deps_win.ps1

$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ThirdParty  = (Resolve-Path "$ScriptDir\..").Path
$Jobs        = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
if (-not $Jobs) { $Jobs = 4 }

function Log  { param([string]$Msg) Write-Host "[setup_deps] $(Get-Date -Format 'HH:mm:ss') $Msg" }
function Err  { param([string]$Msg) Write-Error "[setup_deps] ERROR: $Msg"; exit 1 }

# ────────── LLVM ──────────
function Setup-LLVM {
    $llvmDir = "$ThirdParty\llvm"
    if (Test-Path "$llvmDir\lib\cmake\llvm\LLVMConfig.cmake") {
        Log "LLVM already installed, skipping"
        return
    }

    $ver     = "18.1.8"
    # Use the full development tarball (includes cmake configs + static libs)
    $archive = "clang+llvm-$ver-x86_64-pc-windows-msvc.tar.xz"
    $url     = "https://github.com/llvm/llvm-project/releases/download/llvmorg-$ver/$archive"

    Log "Downloading LLVM $ver development package for Windows..."
    Set-Location $ThirdParty
    if (-not (Test-Path $archive)) {
        curl.exe -L -o $archive $url
        if ($LASTEXITCODE -ne 0) { Err "Failed to download LLVM" }
    }

    Log "Extracting LLVM tar.xz..."
    if (Test-Path $llvmDir) { Remove-Item $llvmDir -Recurse -Force }

    # tar.xz: first extract .xz, then .tar
    7z x $archive -o"$ThirdParty" -y | Out-Null
    if ($LASTEXITCODE -ne 0) { Err "7z xz extraction failed" }

    $tarFile = $archive -replace '\.xz$', ''
    if (Test-Path "$ThirdParty\$tarFile") {
        7z x "$ThirdParty\$tarFile" -o"$ThirdParty" -y | Out-Null
        if ($LASTEXITCODE -ne 0) { Err "7z tar extraction failed" }
        Remove-Item "$ThirdParty\$tarFile" -Force -ErrorAction SilentlyContinue
    }

    # The tarball extracts to clang+llvm-18.1.8-x86_64-pc-windows-msvc/
    $extractedDir = Get-ChildItem $ThirdParty -Directory -Filter "clang+llvm-*" | Select-Object -First 1
    if ($extractedDir) {
        Rename-Item $extractedDir.FullName $llvmDir
    }

    Remove-Item "$ThirdParty\$archive" -Force -ErrorAction SilentlyContinue

    if (-not (Test-Path "$llvmDir\lib\cmake\llvm\LLVMConfig.cmake")) {
        Err "LLVM development package incomplete: LLVMConfig.cmake not found"
    }

    Log "LLVM installed to $llvmDir (cmake configs verified)"
}

# ────────── RocksDB ──────────
function Setup-RocksDB {
    $rocksDir = "$ThirdParty\rocksdb"
    $libFile  = "$rocksDir\build\Release\rocksdb.lib"
    if (Test-Path $libFile) {
        Log "RocksDB already built, skipping"
        return
    }

    Set-Location $ThirdParty
    if (-not (Test-Path "rocksdb")) {
        Log "Cloning RocksDB v9.8.4..."
        git clone --depth 1 --branch v9.8.4 https://github.com/facebook/rocksdb.git
    }

    Log "Building RocksDB with MSVC..."
    Set-Location "$rocksDir"
    New-Item -ItemType Directory -Force -Path build | Out-Null
    Set-Location build
    cmake .. `
        -G "Visual Studio 17 2022" -A x64 `
        -DCMAKE_BUILD_TYPE=Release `
        -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL `
        -DWITH_TESTS=OFF `
        -DWITH_BENCHMARK_TOOLS=OFF `
        -DWITH_TOOLS=OFF `
        -DWITH_GFLAGS=OFF `
        -DROCKSDB_BUILD_SHARED=OFF `
        -DFAIL_ON_WARNINGS=OFF
    cmake --build . --config Release --target rocksdb -j $Jobs
    Log "RocksDB built successfully"
}

# ────────── Protobuf ──────────
function Setup-Protobuf {
    $protoDir = "$ThirdParty\protobuf"
    if ((Test-Path "$protoDir\build\Release\protoc.exe") -or (Test-Path "$protoDir\build\bin\protoc.exe")) {
        Log "Protobuf already built, skipping"
        return
    }

    Set-Location $ThirdParty
    if (-not (Test-Path "protobuf")) {
        Log "Cloning Protobuf v25.6..."
        git clone --depth 1 --branch v25.6 --recurse-submodules https://github.com/protocolbuffers/protobuf.git
    }

    Log "Building Protobuf with MSVC..."
    Set-Location "$protoDir"
    New-Item -ItemType Directory -Force -Path build | Out-Null
    Set-Location build
    cmake .. `
        -G "Visual Studio 17 2022" -A x64 `
        -DCMAKE_BUILD_TYPE=Release `
        -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL `
        -Dprotobuf_BUILD_TESTS=OFF `
        -Dprotobuf_BUILD_EXAMPLES=OFF `
        -Dprotobuf_MSVC_STATIC_RUNTIME=OFF `
        -DABSL_PROPAGATE_CXX_STD=ON `
        -DCMAKE_CXX_STANDARD=17
    cmake --build . --config Release -j $Jobs
    Log "Protobuf built successfully"
}

# ────────── spdlog ──────────
function Setup-Spdlog {
    $spdlogDir = "$ThirdParty\spdlog"
    if (Test-Path "$spdlogDir\include\spdlog") {
        Log "spdlog already present, skipping"
        return
    }

    Log "Cloning spdlog v1.15.2 (header-only)..."
    Set-Location $ThirdParty
    git clone --depth 1 --branch v1.15.2 https://github.com/gabime/spdlog.git
    Log "spdlog ready"
}

# ────────── nlohmann/json ──────────
function Setup-Json {
    $jsonDir = "$ThirdParty\nlohmann"
    if (Test-Path "$jsonDir\json.hpp") {
        Log "nlohmann/json already present, skipping"
        return
    }

    Log "Downloading nlohmann/json single header..."
    New-Item -ItemType Directory -Force -Path $jsonDir | Out-Null
    curl.exe -L -o "$jsonDir\json.hpp" `
        "https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp"
    Log "nlohmann/json ready"
}

# ────────── GoogleTest ──────────
function Setup-GoogleTest {
    $gtestDir = "$ThirdParty\googletest"
    if ((Test-Path "$gtestDir\build\lib\Release") -and (Get-ChildItem "$gtestDir\build\lib\Release" -ErrorAction SilentlyContinue)) {
        Log "GoogleTest already built, skipping"
        return
    }

    Set-Location $ThirdParty
    if (-not (Test-Path "googletest")) {
        Log "Cloning GoogleTest v1.15.2..."
        git clone --depth 1 --branch v1.15.2 https://github.com/google/googletest.git
    }

    Log "Building GoogleTest with MSVC..."
    Set-Location "$gtestDir"
    New-Item -ItemType Directory -Force -Path build | Out-Null
    Set-Location build
    cmake .. -G "Visual Studio 17 2022" -A x64 -DCMAKE_BUILD_TYPE=Release `
        -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL `
        -Dgtest_force_shared_crt=ON
    cmake --build . --config Release -j $Jobs
    Log "GoogleTest built successfully"
}

# ────────── Main ──────────
Log "=== CodeSage Third-Party Dependencies Setup (Windows) ==="
Log "Platform: Windows x64, using $Jobs parallel jobs"

Setup-LLVM
Setup-RocksDB
Setup-Protobuf
Setup-Spdlog
Setup-Json
Setup-GoogleTest

Log "=== All dependencies ready ==="
Log "LLVM:       $ThirdParty\llvm"
Log "RocksDB:    $ThirdParty\rocksdb"
Log "Protobuf:   $ThirdParty\protobuf"
Log "spdlog:     $ThirdParty\spdlog"
Log "json:       $ThirdParty\nlohmann"
Log "GoogleTest: $ThirdParty\googletest"
