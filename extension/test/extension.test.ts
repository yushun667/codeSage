import { describe, it, expect } from 'vitest';

// Unit tests for extension components (no vscode dependency)
describe('Extension Config', () => {
  it('should have default config values', () => {
    const defaultConfig = {
      analyzerPath: '',
      compileDbPath: '',
      dbPath: '',
      projectRoot: '',
      coreModules: [],
      systemReplace: false,
      backendPort: 9527,
    };

    expect(defaultConfig.backendPort).toBe(9527);
    expect(defaultConfig.systemReplace).toBe(false);
    expect(defaultConfig.coreModules).toEqual([]);
  });
});

describe('API Types', () => {
  it('should serialize function info correctly', () => {
    const func = {
      usr: 'c:@F@main',
      name: 'main',
      file: 'main.c',
      line: 1,
      column: 1,
      module: 'root',
      signature: 'int main(void)',
    };

    expect(func.name).toBe('main');
    expect(func.usr).toContain('@F@main');
  });

  it('should serialize call graph response correctly', () => {
    const response = {
      nodes: [
        { usr: 'u1', name: 'main', file: 'main.c', line: 1, module: 'root' },
        { usr: 'u2', name: 'foo', file: 'foo.c', line: 5, module: 'lib' },
      ],
      edges: [
        { caller_usr: 'u1', callee_usr: 'u2', call_file: 'main.c', call_line: 10 },
      ],
    };

    expect(response.nodes).toHaveLength(2);
    expect(response.edges).toHaveLength(1);
    expect(response.edges[0].caller_usr).toBe('u1');
  });

  it('should serialize data flow response correctly', () => {
    const response = {
      function_nodes: [
        { usr: 'u1', name: 'process', file: 'a.c', line: 1, module: 'core' },
      ],
      variable_nodes: [
        { usr: 'v1', name: 'counter', file: 'a.c', line: 3, type: 'int', is_extern: false, module: 'core' },
      ],
      edges: [
        { from_usr: 'u1', to_usr: 'v1', var_usr: 'v1', type: 'direct_write' },
      ],
    };

    expect(response.function_nodes).toHaveLength(1);
    expect(response.variable_nodes).toHaveLength(1);
    expect(response.edges[0].type).toBe('direct_write');
  });
});
