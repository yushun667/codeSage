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
    $archive = "LLVM-$ver-win64.exe"
    $url     = "https://github.com/llvm/llvm-project/releases/download/llvmorg-$ver/$archive"

    Log "Downloading LLVM $ver for Windows..."
    Set-Location $ThirdParty
    if (-not (Test-Path $archive)) {
        curl.exe -L -o $archive $url
        if ($LASTEXITCODE -ne 0) { Err "Failed to download LLVM" }
    }

    # Extract NSIS installer with 7z (more reliable than running installer in CI)
    Log "Extracting LLVM with 7z..."
    if (Test-Path $llvmDir) { Remove-Item $llvmDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $llvmDir | Out-Null

    # 7z extracts NSIS to a $INSTDIR subfolder or flat; handle both
    $tmpDir = "$ThirdParty\llvm_extract"
    if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
    7z x $archive -o"$tmpDir" -y | Out-Null
    if ($LASTEXITCODE -ne 0) { Err "7z extraction failed" }

    # NSIS extractors create `$INSTDIR` or `$_OUTDIR` subfolder
    $inner = Get-ChildItem $tmpDir -Directory | Select-Object -First 1
    if ($inner -and (Test-Path "$($inner.FullName)\bin\clang.exe")) {
        Log "Moving extracted LLVM from subfolder $($inner.Name)..."
        Get-ChildItem $inner.FullName | Move-Item -Destination $llvmDir -Force
    } elseif (Test-Path "$tmpDir\bin\clang.exe") {
        Get-ChildItem $tmpDir | Move-Item -Destination $llvmDir -Force
    } else {
        # Last resort: try NSIS silent install
        Log "7z extraction did not yield expected layout, trying NSIS silent install..."
        Remove-Item $llvmDir -Recurse -Force -ErrorAction SilentlyContinue
        Start-Process -FilePath "$ThirdParty\$archive" -ArgumentList "/S","/D=$llvmDir" -Wait -NoNewWindow
    }

    Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$ThirdParty\$archive" -Force -ErrorAction SilentlyContinue

    if (-not (Test-Path "$llvmDir\bin\clang.exe")) {
        Err "LLVM extraction failed: clang.exe not found in $llvmDir\bin"
    }

    # Verify cmake configs exist
    if (Test-Path "$llvmDir\lib\cmake\llvm\LLVMConfig.cmake") {
        Log "LLVM cmake configs found"
    } else {
        Log "WARNING: LLVMConfig.cmake not found at expected location"
        # List actual structure for debugging
        Log "Contents of lib/cmake:"
        Get-ChildItem "$llvmDir\lib\cmake" -ErrorAction SilentlyContinue | ForEach-Object { Log "  $_" }
    }

    Log "LLVM installed to $llvmDir"
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
        -Dprotobuf_BUILD_TESTS=OFF `
        -Dprotobuf_BUILD_EXAMPLES=OFF `
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
    cmake .. -G "Visual Studio 17 2022" -A x64 -DCMAKE_BUILD_TYPE=Release
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
