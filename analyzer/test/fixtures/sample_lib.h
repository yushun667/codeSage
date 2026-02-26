#ifndef SAMPLE_LIB_H
#define SAMPLE_LIB_H

extern int global_counter;
extern int global_config;

void helper_function(int x);
int read_config(void);
void init_library(void);
void cleanup_library(void);

#endif
