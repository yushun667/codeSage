import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from './logger';

export interface CodeSageConfig {
  analyzerPath: string;
  compileDbPath: string;
  dbPath: string;
  projectRoot: string;
  coreModules: string[];
  systemReplace: boolean;
  backendPort: number;
}

export function getConfig(): CodeSageConfig {
  const cfg = vscode.workspace.getConfiguration('codeSage');
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

  const config: CodeSageConfig = {
    analyzerPath: cfg.get<string>('analyzerPath') || '',
    compileDbPath: cfg.get<string>('compileDbPath') || path.join(workspaceRoot, 'compile_commands.json'),
    dbPath: cfg.get<string>('dbPath') || path.join(workspaceRoot, '.codesage_db'),
    projectRoot: cfg.get<string>('projectRoot') || workspaceRoot,
    coreModules: cfg.get<string[]>('coreModules') || [],
    systemReplace: cfg.get<boolean>('systemReplace') || false,
    backendPort: cfg.get<number>('backendPort') || 9527,
  };

  logger.debug('Config loaded', config);
  return config;
}

export async function configureProject(): Promise<void> {
  logger.info('Opening project configuration');

  const compileDb = await vscode.window.showInputBox({
    prompt: 'compile_commands.json 路径',
    value: getConfig().compileDbPath,
  });
  if (compileDb) {
    await vscode.workspace.getConfiguration('codeSage').update('compileDbPath', compileDb, true);
  }

  const dbPath = await vscode.window.showInputBox({
    prompt: 'RocksDB 数据库存储路径',
    value: getConfig().dbPath,
  });
  if (dbPath) {
    await vscode.workspace.getConfiguration('codeSage').update('dbPath', dbPath, true);
  }

  const projectRoot = await vscode.window.showInputBox({
    prompt: '项目根目录',
    value: getConfig().projectRoot,
  });
  if (projectRoot) {
    await vscode.workspace.getConfiguration('codeSage').update('projectRoot', projectRoot, true);
  }

  const modules = await vscode.window.showInputBox({
    prompt: '核心模块列表（逗号分隔，如 kernel/,mm/）',
    value: getConfig().coreModules.join(','),
  });
  if (modules !== undefined) {
    const moduleList = modules.split(',').filter(Boolean);
    await vscode.workspace.getConfiguration('codeSage').update('coreModules', moduleList, true);
  }

  vscode.window.showInformationMessage('CodeSage 项目配置已更新');
  logger.info('Project configuration updated');
}
