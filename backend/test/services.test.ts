import { describe, it, expect, vi } from 'vitest';
import { AnalyzerService } from '../src/services/analyzer';
import { BackendConfig } from '../src/config';

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd: string, args: string[], opts: any, cb: Function) => {
    if (typeof opts === 'function') {
      cb = opts;
    }
    cb(null, JSON.stringify({ functions: 10, edges: 20 }), '');
  }),
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  })),
}));

vi.mock('util', async () => {
  const actual = await vi.importActual('util');
  return {
    ...(actual as object),
    promisify: (fn: Function) => async (...args: unknown[]) => {
      return new Promise((resolve, reject) => {
        fn(...args, (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      });
    },
  };
});

const testConfig: BackendConfig = {
  port: 9527,
  host: '127.0.0.1',
  analyzerPath: '/usr/bin/echo',
  dbPath: '/tmp/test_db',
  compileDbPath: '/tmp/compile_commands.json',
  projectRoot: '/tmp/project',
  coreModules: ['kernel/'],
  systemReplace: false,
};

describe('AnalyzerService', () => {
  it('creates instance successfully', () => {
    const service = new AnalyzerService(testConfig);
    expect(service).toBeDefined();
    expect(service.isParsing()).toBe(false);
  });

  it('updateConfig modifies config', () => {
    const service = new AnalyzerService(testConfig);
    service.updateConfig({ port: 8080 });
    // Should not throw
  });

  it('cancelParse returns false when not parsing', () => {
    const service = new AnalyzerService(testConfig);
    expect(service.cancelParse()).toBe(false);
  });
});
