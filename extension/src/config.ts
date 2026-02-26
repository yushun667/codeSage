import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger';

export interface CodeSageConfig {
  analyzerPath: string;
  compileDbPath: string;
  dbPath: string;
  projectRoot: string;
  coreModules: string[];
  systemReplace: boolean;
  backendPort: number;
  versionLabel: string;
}

function resolveDefaultAnalyzerPath(): string {
  // __dirname is extension/dist/ at runtime, analyzer is at ../../analyzer/build/code-sage
  const relative = path.resolve(__dirname, '../../analyzer/build/code-sage');
  if (fs.existsSync(relative)) return relative;
  return '';
}

export function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
}

export function getConfig(): CodeSageConfig {
  const cfg = vscode.workspace.getConfiguration('codeSage');
  const workspaceRoot = getWorkspaceRoot();
  const versionLabel = cfg.get<string>('versionLabel') || 'default';

  const baseDbPath = path.join(workspaceRoot, '.codeSage_db');
  const versionedDbPath = versionLabel === 'default' ? baseDbPath : `${baseDbPath}_${versionLabel}`;

  const analyzerPath = cfg.get<string>('analyzerPath') || resolveDefaultAnalyzerPath();

  const config: CodeSageConfig = {
    analyzerPath,
    compileDbPath: cfg.get<string>('compileDbPath') || path.join(workspaceRoot, 'compile_commands.json'),
    dbPath: versionedDbPath,
    projectRoot: workspaceRoot,
    coreModules: cfg.get<string[]>('coreModules') || [],
    systemReplace: cfg.get<boolean>('systemReplace') || false,
    backendPort: cfg.get<number>('backendPort') || 9527,
    versionLabel,
  };

  logger.debug('Config loaded', config);
  return config;
}

export async function configureProject(): Promise<void> {
  logger.info('Opening project configuration');

  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    vscode.window.showWarningMessage('请先打开一个工作区文件夹');
    return;
  }

  const compileDb = await vscode.window.showInputBox({
    prompt: 'compile_commands.json 路径',
    value: getConfig().compileDbPath,
    placeHolder: path.join(workspaceRoot, 'compile_commands.json'),
  });
  if (compileDb !== undefined && compileDb) {
    await vscode.workspace.getConfiguration('codeSage').update('compileDbPath', compileDb, true);
  }

  const version = await vscode.window.showInputBox({
    prompt: '版本标签（如 v5.10、ohos-3.2，不同版本使用独立数据库）',
    value: getConfig().versionLabel,
    placeHolder: 'default',
  });
  if (version !== undefined) {
    await vscode.workspace.getConfiguration('codeSage').update('versionLabel', version || 'default', true);
  }

  vscode.window.showInformationMessage(
    `CodeSage 配置已更新 | 项目: ${workspaceRoot} | 数据库: ${getConfig().dbPath}`
  );
  logger.info('Project configuration updated');
}

export async function selectCoreModules(): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    vscode.window.showWarningMessage('请先打开一个工作区文件夹');
    return;
  }

  const currentModules = getConfig().coreModules;

  // Scan top-level directories as candidates
  let candidates: string[] = [];
  try {
    const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
    candidates = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name + '/');
  } catch {
    logger.warn('Failed to scan workspace directories');
  }

  // Merge with currently selected modules
  const allModules = [...new Set([...candidates, ...currentModules])].sort();

  const items: vscode.QuickPickItem[] = allModules.map(mod => ({
    label: mod,
    picked: currentModules.includes(mod),
    description: currentModules.includes(mod) ? '已选择' : '',
  }));

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: 'CodeSage: 选择核心模块',
    placeHolder: '选择需要分析的核心模块目录（按 Enter 确认）',
  });

  if (selected !== undefined) {
    const modules = selected.map(s => s.label);
    await vscode.workspace.getConfiguration('codeSage').update('coreModules', modules, true);
    vscode.window.showInformationMessage(`核心模块已更新: ${modules.join(', ') || '（无）'}`);
    logger.info('Core modules updated', modules);
  }
}
