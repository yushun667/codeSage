import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import * as os from 'os';
import logger from '../logger';
import { BackendConfig } from '../config';

const execFileAsync = promisify(execFile);

export interface ParseProgress {
  status: 'running' | 'completed' | 'error';
  message: string;
  current?: number;
  total?: number;
  percent?: number;
  data?: Record<string, unknown>;
}

export class AnalyzerService extends EventEmitter {
  private config: BackendConfig;
  private parseProcess: ChildProcess | null = null;

  constructor(config: BackendConfig) {
    super();
    this.config = config;
    logger.info('AnalyzerService initialized', { analyzerPath: config.analyzerPath });
  }

  async query(subcommand: string, args: Record<string, string>): Promise<unknown> {
    const cmdArgs = ['query', subcommand, `--db=${this.config.dbPath}`];

    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined && value !== '') {
        cmdArgs.push(`--${key}=${value}`);
      }
    }

    logger.info('Running query', { subcommand, args: cmdArgs });

    try {
      const { stdout, stderr } = await execFileAsync(
        this.config.analyzerPath,
        cmdArgs,
        { maxBuffer: 50 * 1024 * 1024, timeout: 30000 }
      );

      if (stderr) {
        logger.warn('Analyzer stderr output', { stderr: stderr.substring(0, 500) });
      }

      const result = JSON.parse(stdout);
      logger.debug('Query result', { subcommand, resultSize: stdout.length });
      return result;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('Query failed', { subcommand, error: errMsg });
      throw new Error(`Query failed: ${errMsg}`);
    }
  }

  async startParse(): Promise<void> {
    if (this.parseProcess) {
      throw new Error('Parse already in progress');
    }

    const { compileDbPath, dbPath, projectRoot, coreModules, systemReplace, analyzerPath } = this.config;

    if (!compileDbPath || !dbPath) {
      throw new Error('compileDbPath and dbPath must be configured');
    }

    const args = [
      'parse',
      `--compile-db=${compileDbPath}`,
      `--db=${dbPath}`,
      `--project-root=${projectRoot}`,
    ];

    if (coreModules.length > 0) {
      args.push(`--modules=${coreModules.join(',')}`);
    }
    if (systemReplace) {
      args.push('--system-replace');
    }
    if (this.config.parseJobs > 0) {
      args.push(`--jobs=${this.config.parseJobs}`);
    }

    logger.info('Starting parse', { args });
    this.emit('progress', { status: 'running', message: 'Parse started' } as ParseProgress);

    return new Promise((resolve, reject) => {
      this.parseProcess = spawn(analyzerPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let stderrLineBuffer = '';

      this.parseProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      let totalFiles = 0;

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        logger.debug('Parse output', { line: trimmed });

        const progress: ParseProgress = { status: 'running', message: trimmed };

        const totalMatch = trimmed.match(/(\d+)\s+files?\s+need\s+pars/);
        if (totalMatch) {
          totalFiles = parseInt(totalMatch[1], 10);
        }

        const fileMatch = trimmed.match(/\[(\d+)\/(\d+)\]\s+Process(?:ing|ed)\s+file\s+(.*)/);
        if (fileMatch) {
          const current = parseInt(fileMatch[1], 10);
          const total = parseInt(fileMatch[2], 10);
          if (total > totalFiles) totalFiles = total;
          progress.current = current;
          progress.total = totalFiles || total;
          progress.percent = Math.round((current / (totalFiles || total)) * 100);
          const fileName = fileMatch[3].replace(/\.$/, '').split('/').pop() || fileMatch[3];
          progress.message = fileName;
        }

        this.emit('progress', progress);
      };

      this.parseProcess.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;

        // Buffer incomplete lines across data events
        stderrLineBuffer += chunk;
        const lines = stderrLineBuffer.split('\n');
        // Keep the last element (possibly incomplete line) in the buffer
        stderrLineBuffer = lines.pop() || '';
        for (const line of lines) {
          processLine(line);
        }
      });

      this.parseProcess.on('close', (code: number | null) => {
        this.parseProcess = null;

        // Flush remaining buffer
        if (stderrLineBuffer.trim()) {
          processLine(stderrLineBuffer);
          stderrLineBuffer = '';
        }

        if (code === 0) {
          let stats = {};
          try { stats = JSON.parse(stdout); } catch { /* ignore */ }

          logger.info('Parse completed', { stats });
          this.emit('progress', {
            status: 'completed',
            message: 'Parse completed successfully',
            data: stats,
          } as ParseProgress);
          resolve();
        } else {
          const errMsg = `Parse failed with code ${code}: ${stderr.substring(0, 500)}`;
          logger.error(errMsg);
          this.emit('progress', { status: 'error', message: errMsg } as ParseProgress);
          reject(new Error(errMsg));
        }
      });

      this.parseProcess.on('error', (err: Error) => {
        this.parseProcess = null;
        logger.error('Parse process error', { error: err.message });
        this.emit('progress', { status: 'error', message: err.message } as ParseProgress);
        reject(err);
      });
    });
  }

  cancelParse(): boolean {
    if (this.parseProcess) {
      logger.info('Cancelling parse');
      if (os.platform() === 'win32') {
        spawn('taskkill', ['/pid', String(this.parseProcess.pid), '/f', '/t']);
      } else {
        this.parseProcess.kill('SIGTERM');
      }
      this.parseProcess = null;
      this.emit('progress', {
        status: 'error',
        message: '解析已被用户取消',
      } as ParseProgress);
      return true;
    }
    return false;
  }

  isParsing(): boolean {
    return this.parseProcess !== null;
  }

  async getStats(): Promise<unknown> {
    const args = ['stats', `--db=${this.config.dbPath}`];

    try {
      const { stdout } = await execFileAsync(this.config.analyzerPath, args, {
        timeout: 5000,
      });
      return JSON.parse(stdout);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('Stats query failed', { error: errMsg });
      return { error: errMsg };
    }
  }

  updateConfig(updates: Partial<BackendConfig>): void {
    Object.assign(this.config, updates);
    logger.info('Config updated', updates);
  }
}
