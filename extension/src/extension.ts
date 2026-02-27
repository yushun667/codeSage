import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { logger } from './logger';
import { getConfig, configureProject, selectCoreModules } from './config';
import { BackendManager } from './backendManager';
import { GraphPanel } from './views/graphPanel';
import { SearchResultsProvider } from './views/searchResultsProvider';
import { parseProject, cancelParse } from './commands/parseProject';
import { searchFunction } from './commands/searchFunction';
import { searchVariable } from './commands/searchVariable';
import { FunctionInfo, GlobalVarInfo } from './apiClient';

let backendManager: BackendManager;
const searchResultsProvider = new SearchResultsProvider();
let parseStatusBarItem: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  logger.info('CodeSage extension activating');

  const config = getConfig();
  backendManager = new BackendManager(config);

  vscode.window.registerTreeDataProvider('codesage.searchResults', searchResultsProvider);

  // --- Status bar: parse button ---
  parseStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 200);
  parseStatusBarItem.command = 'codeSage.parseProject';
  parseStatusBarItem.text = '$(play) CodeSage: 解析';
  parseStatusBarItem.tooltip = '点击开始解析项目代码';
  parseStatusBarItem.show();
  context.subscriptions.push(parseStatusBarItem);

  async function getClient() {
    try {
      return await backendManager.start();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`无法启动后端服务: ${msg}`);
      logger.error('Failed to start backend', msg);
      throw err;
    }
  }

  function showFunctionInGraph(func: FunctionInfo) {
    getClient().then(client => {
      const panel = GraphPanel.createOrShow(context.extensionUri, client);
      panel.showFunctionCallGraph(func, 'forward');
    });
  }

  function showVariableInGraph(variable: GlobalVarInfo) {
    getClient().then(client => {
      const panel = GraphPanel.createOrShow(context.extensionUri, client);
      panel.showVariableDataFlow(variable);
    });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('codeSage.configureProject', () => {
      configureProject();
    }),

    vscode.commands.registerCommand('codeSage.selectCoreModules', () => {
      selectCoreModules();
    }),

    vscode.commands.registerCommand('codeSage.parseProject', async () => {
      const client = await getClient();
      try {
        const reason = await parseProject(client, parseStatusBarItem);
        if (reason === 'completed') {
          parseStatusBarItem.text = '$(check) CodeSage: 解析完成';
          parseStatusBarItem.tooltip = '解析已完成，点击重新解析';
        } else if (reason === 'cancelled') {
          parseStatusBarItem.text = '$(play) CodeSage: 解析';
          parseStatusBarItem.tooltip = '点击开始解析项目代码';
        } else {
          parseStatusBarItem.text = '$(error) CodeSage: 解析出错';
          parseStatusBarItem.tooltip = '解析出错，点击重试';
        }
      } catch {
        parseStatusBarItem.text = '$(error) CodeSage: 解析出错';
        parseStatusBarItem.tooltip = '解析出错，点击重试';
      }
      parseStatusBarItem.command = 'codeSage.parseProject';
    }),

    vscode.commands.registerCommand('codeSage.cancelParse', async () => {
      const client = await getClient();
      await cancelParse(client);
    }),

    vscode.commands.registerCommand('codeSage.searchFunction', async () => {
      const client = await getClient();
      searchFunction(client, showFunctionInGraph);
    }),

    vscode.commands.registerCommand('codeSage.searchFunctionAtCursor', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.selection;
      let word: string | undefined;

      if (!selection.isEmpty) {
        word = editor.document.getText(selection).trim();
      } else {
        const wordRange = editor.document.getWordRangeAtPosition(selection.active);
        if (wordRange) {
          word = editor.document.getText(wordRange).trim();
        }
      }

      if (!word) {
        vscode.window.showWarningMessage('请将光标放在函数名上或选中函数名');
        return;
      }

      const client = await getClient();
      try {
        const results = await client.searchFunctions(word);
        if (results.length === 0) {
          vscode.window.showInformationMessage(`未找到函数 "${word}"（请确认已完成解析）`);
          return;
        }

        let target = results[0];
        if (results.length > 1) {
          const items = results.map(f => ({
            label: f.name,
            description: `${f.module} — ${f.file}:${f.line}`,
            detail: f.signature || f.usr,
            func: f,
          }));
          const picked = await vscode.window.showQuickPick(items, {
            placeHolder: `找到 ${results.length} 个匹配，选择目标函数`,
          });
          if (!picked) return;
          target = picked.func;
        }

        showFunctionInGraph(target);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`搜索失败: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('codeSage.searchVariable', async () => {
      const client = await getClient();
      searchVariable(client, showVariableInGraph);
    }),

    vscode.commands.registerCommand('codeSage.openGraph', async () => {
      const client = await getClient();
      GraphPanel.createOrShow(context.extensionUri, client);
    }),

    vscode.commands.registerCommand('codeSage.showFunctionGraph', (func: FunctionInfo) => {
      showFunctionInGraph(func);
    }),

    vscode.commands.registerCommand('codeSage.showVariableDataFlow', (variable: GlobalVarInfo) => {
      showVariableInGraph(variable);
    }),

    vscode.commands.registerCommand('codeSage.openLogs', async () => {
      const logDir = path.join(os.homedir(), '.codesage', 'logs');
      const items = [
        { label: '扩展日志 (extension.log)', file: 'extension.log' },
        { label: '后端日志 (backend.log)', file: 'backend.log' },
        { label: '分析器日志 (analyzer.log)', file: 'analyzer.log' },
        { label: '输出面板 (Output Channel)', file: '__output__' },
      ];
      const pick = await vscode.window.showQuickPick(items, { title: 'CodeSage: 打开日志' });
      if (!pick) return;
      if (pick.file === '__output__') {
        logger.show();
      } else {
        const logPath = vscode.Uri.file(path.join(logDir, pick.file));
        try {
          await vscode.workspace.openTextDocument(logPath);
          await vscode.window.showTextDocument(logPath);
        } catch {
          vscode.window.showWarningMessage(`日志文件不存在: ${pick.file}（分析器可能还未运行过）`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codeSage')) {
        const newConfig = getConfig();
        backendManager.updateConfig(newConfig);
        logger.info('Config changed, backend updated');
      }
    })
  );

  logger.info('CodeSage extension activated');
}

export async function deactivate() {
  logger.info('CodeSage extension deactivating');

  if (backendManager) {
    await backendManager.stop();
  }

  logger.dispose();
}
