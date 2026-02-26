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

  const cfgKey = vscode.workspace.getConfiguration('codeSage');
  let currentModules = [...(cfgKey.get<string[]>('coreModules') || [])];

  // Loop: show current list with action items until user confirms
  while (true) {
    const items: vscode.QuickPickItem[] = [];

    items.push({
      label: '$(add) 添加模块目录...',
      description: '浏览项目目录并添加',
      alwaysShow: true,
    });

    if (currentModules.length > 0) {
      items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
      for (const mod of currentModules) {
        items.push({
          label: mod,
          description: '$(trash) 点击移除',
        });
      }
    }

    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: '$(check) 确认完成',
      description: `当前 ${currentModules.length} 个模块`,
      alwaysShow: true,
    });

    const pick = await vscode.window.showQuickPick(items, {
      title: `CodeSage: 核心模块管理（已选 ${currentModules.length} 个）`,
      placeHolder: '添加/移除核心模块目录，完成后点击确认',
    });

    if (!pick) return; // cancelled

    if (pick.label === '$(check) 确认完成') {
      await cfgKey.update('coreModules', currentModules, true);
      vscode.window.showInformationMessage(
        `核心模块已更新: ${currentModules.join(', ') || '（无）'}`
      );
      logger.info('Core modules updated', currentModules);
      return;
    }

    if (pick.label === '$(add) 添加模块目录...') {
      const uris = await vscode.window.showOpenDialog({
        defaultUri: vscode.Uri.file(workspaceRoot),
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: true,
        openLabel: '选择模块目录',
        title: '选择核心模块目录',
      });
      if (uris && uris.length > 0) {
        for (const uri of uris) {
          let rel = path.relative(workspaceRoot, uri.fsPath);
          if (!rel.endsWith('/')) rel += '/';
          if (!currentModules.includes(rel)) {
            currentModules.push(rel);
          }
        }
        currentModules.sort();
      }
      continue;
    }

    // Clicked on an existing module → remove it
    currentModules = currentModules.filter(m => m !== pick.label);
  }
}
