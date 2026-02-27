import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import { logger } from './logger';
import { ApiClient } from './apiClient';
import { CodeSageConfig } from './config';

export class BackendManager {
  private process: ChildProcess | null = null;
  private client: ApiClient | null = null;
  private config: CodeSageConfig;

  constructor(config: CodeSageConfig) {
    this.config = config;
    logger.info('BackendManager initialized');
  }

  async start(): Promise<ApiClient> {
    logger.info('Starting backend service...');

    if (this.client) {
      const healthy = await this.client.healthCheck();
      if (healthy) {
        logger.info('Backend already running');
        return this.client;
      }
    }

    const backendDir = path.resolve(__dirname, '../../backend');
    const env = {
      ...process.env,
      CODESAGE_PORT: String(this.config.backendPort),
      CODESAGE_ANALYZER_PATH: this.config.analyzerPath,
      CODESAGE_DB_PATH: this.config.dbPath,
      CODESAGE_COMPILE_DB_PATH: this.config.compileDbPath,
      CODESAGE_PROJECT_ROOT: this.config.projectRoot,
      CODESAGE_CORE_MODULES: this.config.coreModules.join(','),
      CODESAGE_SYSTEM_REPLACE: String(this.config.systemReplace),
      CODESAGE_PARSE_JOBS: String(this.config.parseJobs),
    };

    this.process = spawn('node', [path.join(backendDir, 'dist', 'index.js')], {
      cwd: backendDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      logger.debug(`[backend stdout] ${data.toString().trim()}`);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      logger.debug(`[backend stderr] ${data.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      logger.info(`Backend process exited with code ${code}`);
      this.process = null;
    });

    this.process.on('error', (err) => {
      logger.error(`Backend process error: ${err.message}`);
      this.process = null;
    });

    this.client = new ApiClient(this.config.backendPort);

    // Wait for backend to be ready
    const maxRetries = 20;
    for (let i = 0; i < maxRetries; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const healthy = await this.client.healthCheck();
      if (healthy) {
        logger.info('Backend service is ready');
        return this.client;
      }
    }

    throw new Error('Backend service failed to start within timeout');
  }

  async stop(): Promise<void> {
    logger.info('Stopping backend service...');
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.client = null;
  }

  getClient(): ApiClient | null {
    return this.client;
  }

  isRunning(): boolean {
    return this.process !== null;
  }

  updateConfig(config: CodeSageConfig): void {
    this.config = config;
    if (this.client) {
      this.client.updateConfig({
        dbPath: config.dbPath,
        compileDbPath: config.compileDbPath,
        projectRoot: config.projectRoot,
        coreModules: config.coreModules,
        systemReplace: config.systemReplace,
        parseJobs: config.parseJobs,
      }).catch(err => {
        logger.warn(`Failed to update backend config: ${err.message}`);
      });
    }
  }
}
