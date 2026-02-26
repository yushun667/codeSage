#include "utils.h"
#include <stdio.h>

static int initialized = 0;

void init_system(void) {
    initialized = 1;
    global_counter = 0;
    log_event("system initialized");
}

void shutdown_system(void) {
    initialized = 0;
    log_event("system shutdown");
}

void log_event(const char *msg) {
    if (initialized) {
        printf("[LOG] %s\n", msg);
    }
}

int get_config(void) {
    return global_config;
}
