#ifndef UTILS_H
#define UTILS_H

extern int global_counter;
extern int global_config;

void init_system(void);
void shutdown_system(void);
void log_event(const char *msg);
int get_config(void);

#endif
