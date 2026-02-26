import * as vscode from 'vscode';
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
      parseStatusBarItem.text = '$(sync~spin) CodeSage: 解析中...';
      parseStatusBarItem.command = 'codeSage.cancelParse';
      parseStatusBarItem.tooltip = '点击取消解析';
      try {
        const reason = await parseProject(client, parseStatusBarItem);
        if (reason === 'completed') {
          parseStatusBarItem.text = '$(check) CodeSage: 解析完成';
          parseStatusBarItem.tooltip = '解析已完成，点击重新解析';
        } else if (reason === 'cancelled') {
          parseStatusBarItem.text = '$(circle-slash) CodeSage: 已取消';
          parseStatusBarItem.tooltip = '解析已取消，点击重新解析';
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
