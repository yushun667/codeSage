import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const LOG_DIR = path.join(os.homedir(), '.codesage', 'logs');

class ExtensionLogger {
  private outputChannel: vscode.OutputChannel;
  private logStream: fs.WriteStream | null = null;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('CodeSage');

    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    const logPath = path.join(LOG_DIR, 'extension.log');
    this.logStream = fs.createWriteStream(logPath, { flags: 'a' });
  }

  private formatMessage(level: string, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const formatted = args.length > 0 ? `${message} ${JSON.stringify(args)}` : message;
    return `[${timestamp}] [${level}] ${formatted}`;
  }

  private write(level: string, message: string, ...args: unknown[]): void {
    const formatted = this.formatMessage(level, message, ...args);
    this.outputChannel.appendLine(formatted);
    this.logStream?.write(formatted + '\n');
  }

  info(message: string, ...args: unknown[]): void {
    this.write('INFO', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.write('WARN', message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.write('ERROR', message, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.write('DEBUG', message, ...args);
  }

  show(): void {
    this.outputChannel.show();
  }

  dispose(): void {
    this.outputChannel.dispose();
    this.logStream?.end();
  }
}

export const logger = new ExtensionLogger();
