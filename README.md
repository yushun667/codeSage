# CodeSage — 函数调用链与全局变量数据流分析工具

基于 Clang LibTooling 的 VSCode 插件，用于解析大型 C/C++ 项目（如 Linux 内核、OpenHarmony）的函数调用链和全局变量数据流。

## 架构

```
VSCode Extension (TypeScript + React + Sigma.js)
        ↕ REST API (HTTP)
Node.js Backend (Express, 进程管理)
        ↕ Child Process
C++ Core Analyzer (Clang LibTooling + RocksDB)
```

## 前置要求

- macOS (arm64) 或 Linux (x86_64)
- CMake 3.20+
- C++17 编译器
- Node.js 18+
- npm 9+
- Git

## 快速开始

### 1. 下载第三方依赖

```bash
cd third_party/scripts
chmod +x setup_deps.sh
./setup_deps.sh
```

此脚本会自动下载并编译：
- LLVM/Clang 18.x（预编译二进制包）
- RocksDB（从源码编译）
- Protobuf（从源码编译）
- spdlog（header-only）
- nlohmann/json（单头文件）
- GoogleTest（从源码编译）

### 2. 编译 C++ 分析器

```bash
cd analyzer
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . -j$(nproc 2>/dev/null || sysctl -n hw.ncpu)
```

### 3. 启动后端服务

```bash
cd backend
npm install
npm run build
npm start
```

### 4. 安装 VSCode 插件

```bash
cd extension
npm install
cd webview && npm install && npm run build && cd ..
npm run package
# 安装生成的 .vsix 文件
code --install-extension codesage-*.vsix
```

## 使用方法

1. 在 VSCode 中打开 C/C++ 项目
2. 确保项目根目录有 `compile_commands.json`
3. 通过命令面板执行 `CodeSage: 配置项目`
4. 执行 `CodeSage: 开始解析` 触发源码分析
5. 执行 `CodeSage: 搜索函数` 或 `CodeSage: 搜索全局变量`
6. 在图谱视图中探索调用链和数据流

## CLI 使用

```bash
# 解析项目
./code-sage parse \
  --compile-db=/path/to/compile_commands.json \
  --db=/path/to/output_db \
  --modules=kernel/,mm/

# 搜索函数
./code-sage query search-functions --db=<path> --query=schedule

# 查看正向调用链
./code-sage query callgraph-forward --db=<path> --usr=<usr> --depth=3

# 查看反向调用链
./code-sage query callgraph-backward --db=<path> --usr=<usr> --depth=3

# 搜索全局变量
./code-sage query search-variables --db=<path> --query=jiffies

# 查看数据流
./code-sage query dataflow --db=<path> --var-usr=<usr> --depth=3
```

## 项目结构

```
codeSage/
├── analyzer/        C++ 核心分析器 (Clang LibTooling + RocksDB)
├── backend/         Node.js 后端 REST API
├── extension/       VSCode 插件
│   └── webview/     React + Sigma.js 前端
├── proto/           Protobuf 定义
├── third_party/     第三方依赖
└── doc/             文档
```

## 许可证

MIT
