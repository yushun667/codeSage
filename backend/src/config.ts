import path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import logger from './logger';

export interface BackendConfig {
  port: number;
  host: string;
  analyzerPath: string;
  dbPath: string;
  compileDbPath: string;
  projectRoot: string;
  coreModules: string[];
  systemReplace: boolean;
  parseJobs: number;
}

const BIN_NAME = os.platform() === 'win32' ? 'code-sage.exe' : 'code-sage';

function resolveDefaultAnalyzerPath(): string {
  // Packaged: bin/ next to backend/dist/
  const bundled = path.resolve(__dirname, '../../bin', BIN_NAME);
  if (fs.existsSync(bundled)) return bundled;
  // Development
  return path.resolve(__dirname, '../../analyzer/build', BIN_NAME);
}

const DEFAULT_ANALYZER_PATH = resolveDefaultAnalyzerPath();

export function loadConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  const config: BackendConfig = {
    port: parseInt(process.env.CODESAGE_PORT || '9527', 10),
    host: process.env.CODESAGE_HOST || '127.0.0.1',
    analyzerPath: process.env.CODESAGE_ANALYZER_PATH || DEFAULT_ANALYZER_PATH,
    dbPath: process.env.CODESAGE_DB_PATH || '',
    compileDbPath: process.env.CODESAGE_COMPILE_DB_PATH || '',
    projectRoot: process.env.CODESAGE_PROJECT_ROOT || '',
    coreModules: (process.env.CODESAGE_CORE_MODULES || '').split(',').filter(Boolean),
    systemReplace: process.env.CODESAGE_SYSTEM_REPLACE === 'true',
    parseJobs: parseInt(process.env.CODESAGE_PARSE_JOBS || '0', 10),
    ...overrides,
  };

  logger.info('Config loaded', {
    port: config.port,
    analyzerPath: config.analyzerPath,
    dbPath: config.dbPath,
  });

  return config;
}
