#!/usr/bin/env bash
# Integration test: builds test project, runs analyzer, validates results
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ANALYZER="$PROJECT_ROOT/analyzer/build/code-sage"
FIXTURE_DIR="$SCRIPT_DIR/fixtures/project"
TEST_DB="/tmp/codesage_integration_test_db"
TEST_COMPILE_DB="/tmp/codesage_integration_test_compile_commands.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass=0
fail=0

assert_contains() {
    local desc="$1"
    local output="$2"
    local expected="$3"

    if echo "$output" | grep -q "$expected"; then
        echo -e "  ${GREEN}PASS${NC}: $desc"
        ((pass++))
    else
        echo -e "  ${RED}FAIL${NC}: $desc (expected '$expected' in output)"
        echo "  Output: ${output:0:200}"
        ((fail++))
    fi
}

assert_json_field() {
    local desc="$1"
    local output="$2"
    local field="$3"
    local expected="$4"

    local actual
    actual=$(echo "$output" | python3 -c "import sys,json; print(json.load(sys.stdin).get('$field', 'MISSING'))" 2>/dev/null || echo "PARSE_ERROR")

    if [ "$actual" = "$expected" ]; then
        echo -e "  ${GREEN}PASS${NC}: $desc"
        ((pass++))
    else
        echo -e "  ${RED}FAIL${NC}: $desc (expected $field=$expected, got $actual)"
        ((fail++))
    fi
}

cleanup() {
    rm -rf "$TEST_DB" "$TEST_COMPILE_DB"
}

# Setup
echo "=== CodeSage Integration Test ==="
echo ""

cleanup

if [ ! -f "$ANALYZER" ]; then
    echo -e "${RED}ERROR: Analyzer not found at $ANALYZER${NC}"
    echo "Build the analyzer first: cd analyzer && mkdir -p build && cd build && cmake .. && make"
    exit 1
fi

# Generate compile_commands.json for the test fixture
echo "Generating compile_commands.json..."
cat > "$TEST_COMPILE_DB" << CCEOF
[
  {
    "directory": "$FIXTURE_DIR",
    "command": "cc -c -I$FIXTURE_DIR $FIXTURE_DIR/main.c -o /dev/null",
    "file": "$FIXTURE_DIR/main.c"
  },
  {
    "directory": "$FIXTURE_DIR",
    "command": "cc -c -I$FIXTURE_DIR $FIXTURE_DIR/utils.c -o /dev/null",
    "file": "$FIXTURE_DIR/utils.c"
  }
]
CCEOF

# Test 1: Parse
echo ""
echo "--- Test 1: Parse Project ---"
PARSE_OUTPUT=$("$ANALYZER" parse \
    --compile-db="$TEST_COMPILE_DB" \
    --db="$TEST_DB" \
    --project-root="$FIXTURE_DIR" 2>/dev/null)

assert_contains "Parse returns JSON" "$PARSE_OUTPUT" "files_processed"
assert_contains "Functions collected" "$PARSE_OUTPUT" "functions_collected"
assert_contains "Edges collected" "$PARSE_OUTPUT" "edges_collected"
assert_contains "Variables collected" "$PARSE_OUTPUT" "variables_collected"

# Test 2: Stats
echo ""
echo "--- Test 2: Stats ---"
STATS_OUTPUT=$("$ANALYZER" stats --db="$TEST_DB" 2>/dev/null)
assert_contains "Stats has functions" "$STATS_OUTPUT" "functions"
assert_contains "Stats has edges" "$STATS_OUTPUT" "edges"
assert_contains "Stats has variables" "$STATS_OUTPUT" "variables"

# Test 3: Search functions
echo ""
echo "--- Test 3: Search Functions ---"
SEARCH_OUTPUT=$("$ANALYZER" query search-functions --db="$TEST_DB" --query=process 2>/dev/null)
assert_contains "Found process_item" "$SEARCH_OUTPUT" "process_item"

SEARCH_OUTPUT2=$("$ANALYZER" query search-functions --db="$TEST_DB" --query=main 2>/dev/null)
assert_contains "Found main" "$SEARCH_OUTPUT2" "main"

# Test 4: Forward call graph
echo ""
echo "--- Test 4: Forward Call Graph ---"
# First get main's USR
MAIN_INFO=$("$ANALYZER" query search-functions --db="$TEST_DB" --query=main --limit=1 2>/dev/null)
MAIN_USR=$(echo "$MAIN_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['usr'] if d else 'NOTFOUND')" 2>/dev/null || echo "NOTFOUND")

if [ "$MAIN_USR" != "NOTFOUND" ]; then
    FWD_OUTPUT=$("$ANALYZER" query callgraph-forward --db="$TEST_DB" --usr="$MAIN_USR" --depth=3 2>/dev/null)
    assert_contains "Forward graph has nodes" "$FWD_OUTPUT" "nodes"
    assert_contains "Forward graph has edges" "$FWD_OUTPUT" "edges"
    assert_contains "Forward graph includes compute" "$FWD_OUTPUT" "compute"
else
    echo -e "  ${RED}SKIP${NC}: Could not find main USR"
    ((fail++))
fi

# Test 5: Search variables
echo ""
echo "--- Test 5: Search Variables ---"
VAR_OUTPUT=$("$ANALYZER" query search-variables --db="$TEST_DB" --query=global 2>/dev/null)
assert_contains "Found global_counter" "$VAR_OUTPUT" "global_counter"
assert_contains "Found global_config" "$VAR_OUTPUT" "global_config"

# Test 6: Variable accesses
echo ""
echo "--- Test 6: Variable Accesses ---"
COUNTER_INFO=$(echo "$VAR_OUTPUT" | python3 -c "
import sys,json
data=json.load(sys.stdin)
for v in data:
    if v['name']=='global_counter':
        print(v['usr'])
        break
" 2>/dev/null || echo "NOTFOUND")

if [ -n "$COUNTER_INFO" ] && [ "$COUNTER_INFO" != "NOTFOUND" ]; then
    ACC_OUTPUT=$("$ANALYZER" query variable-accesses --db="$TEST_DB" --var-usr="$COUNTER_INFO" 2>/dev/null)
    assert_contains "Has variable accesses" "$ACC_OUTPUT" "function_usr"
fi

# Test 7: Data flow
echo ""
echo "--- Test 7: Data Flow ---"
if [ -n "$COUNTER_INFO" ] && [ "$COUNTER_INFO" != "NOTFOUND" ]; then
    DF_OUTPUT=$("$ANALYZER" query dataflow --db="$TEST_DB" --var-usr="$COUNTER_INFO" --depth=3 2>/dev/null)
    assert_contains "Data flow has function_nodes" "$DF_OUTPUT" "function_nodes"
    assert_contains "Data flow has variable_nodes" "$DF_OUTPUT" "variable_nodes"
    assert_contains "Data flow has edges" "$DF_OUTPUT" "edges"
fi

# Summary
echo ""
echo "=== Results ==="
echo -e "Passed: ${GREEN}$pass${NC}"
echo -e "Failed: ${RED}$fail${NC}"

cleanup

if [ $fail -gt 0 ]; then
    exit 1
fi
echo -e "${GREEN}All tests passed!${NC}"
