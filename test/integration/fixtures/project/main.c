// Integration test fixture: small C project
#include "utils.h"

int global_counter = 0;
int global_config = 100;
static int local_state = 0;

void process_item(int value) {
    global_counter += value;
    local_state++;
    log_event("process_item called");
}

int read_counter(void) {
    return global_counter;
}

int compute(int x, int y) {
    int cfg = get_config();
    process_item(x + y + cfg);
    return read_counter();
}

int main(void) {
    init_system();
    int result = compute(1, 2);
    shutdown_system();
    return result;
}
