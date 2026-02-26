// Test fixture: a small C project to verify analysis capabilities

#include "sample_lib.h"

int global_counter = 0;
int global_config = 42;

void process_data(int value) {
    global_counter += value;
    helper_function(value);
}

int compute_result(void) {
    int base = read_config();
    process_data(base);
    return global_counter;
}

int main(void) {
    init_library();
    int result = compute_result();
    cleanup_library();
    return result;
}
