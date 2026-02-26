import path from 'path';
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

const DEFAULT_ANALYZER_PATH = path.resolve(__dirname, '../../analyzer/build/code-sage');

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
