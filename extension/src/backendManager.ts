import * as vscode from 'vscode';
import { ChildProcess, spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger';
import { ApiClient } from './apiClient';
import { CodeSageConfig } from './config';

export class BackendManager {
  private process: ChildProcess | null = null;
  private client: ApiClient | null = null;
  private config: CodeSageConfig;
  private processExited = false;
  private processError = '';

  constructor(config: CodeSageConfig) {
    this.config = config;
    logger.info('BackendManager initialized');
  }

  async start(): Promise<ApiClient> {
    logger.info('Starting backend service...');

    // If we already have a healthy client, reuse it
    if (this.client) {
      const healthy = await this.client.healthCheck();
      if (healthy) {
        logger.info('Backend already running');
        return this.client;
      }
      logger.info('Previous backend not healthy, restarting...');
    }

    // If we don't own the process, check if someone else is listening
    if (!this.process) {
      const tempClient = new ApiClient(this.config.backendPort);
      const alreadyUp = await tempClient.healthCheck();
      if (alreadyUp) {
        logger.info('Backend already running on port (external)');
        this.client = tempClient;
        return this.client;
      }
    }

    // Kill any zombie process on our port
    this.killPortProcess(this.config.backendPort);

    // Stop old process if any
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }

    const backendDir = path.resolve(__dirname, '../../backend');
    const entryFile = path.join(backendDir, 'dist', 'index.js');

    if (!fs.existsSync(entryFile)) {
      throw new Error(`后端入口文件不存在: ${entryFile}`);
    }

    logger.info(`Backend dir: ${backendDir}, entry: ${entryFile}`);

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

    this.processExited = false;
    this.processError = '';

    this.process = spawn('node', [entryFile], {
      cwd: backendDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      logger.debug(`[backend stdout] ${data.toString().trim()}`);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      logger.debug(`[backend stderr] ${msg}`);
      this.processError = msg;
    });

    this.process.on('exit', (code) => {
      logger.info(`Backend process exited with code ${code}`);
      this.processExited = true;
      this.process = null;
    });

    this.process.on('error', (err) => {
      logger.error(`Backend process spawn error: ${err.message}`);
      this.processExited = true;
      this.processError = err.message;
      this.process = null;
    });

    this.client = new ApiClient(this.config.backendPort);

    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));

      // Early exit if the process already crashed
      if (this.processExited) {
        throw new Error(`后端进程已退出: ${this.processError || '未知错误'}`);
      }

      const healthy = await this.client.healthCheck();
      if (healthy) {
        logger.info('Backend service is ready');
        return this.client;
      }
    }

    throw new Error('后端服务启动超时（15秒），请检查日志');
  }

  private killPortProcess(port: number): void {
    try {
      const result = execSync(`lsof -ti :${port} 2>/dev/null`).toString().trim();
      if (result) {
        const pids = result.split('\n');
        for (const pid of pids) {
          logger.info(`Killing zombie process ${pid} on port ${port}`);
          try { process.kill(parseInt(pid), 'SIGTERM'); } catch { /* ignore */ }
        }
        // Brief wait for port release
        execSync('sleep 0.5');
      }
    } catch {
      // No process on port — normal
    }
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
