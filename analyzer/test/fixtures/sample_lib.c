#include "sample_lib.h"

static int internal_state = 0;

void helper_function(int x) {
    internal_state += x;
    global_counter++;
}

int read_config(void) {
    return global_config;
}

void init_library(void) {
    internal_state = 0;
    global_counter = 0;
}

void cleanup_library(void) {
    internal_state = 0;
}
