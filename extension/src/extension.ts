import * as vscode from 'vscode';
import { logger } from './logger';
import { getConfig, configureProject } from './config';
import { BackendManager } from './backendManager';
import { GraphPanel } from './views/graphPanel';
import { SearchResultsProvider } from './views/searchResultsProvider';
import { parseProject, cancelParse } from './commands/parseProject';
import { searchFunction } from './commands/searchFunction';
import { searchVariable } from './commands/searchVariable';
import { FunctionInfo, GlobalVarInfo } from './apiClient';

let backendManager: BackendManager;
const searchResultsProvider = new SearchResultsProvider();

export async function activate(context: vscode.ExtensionContext) {
  logger.info('CodeSage extension activating');

  const config = getConfig();
  backendManager = new BackendManager(config);

  // Register tree view
  vscode.window.registerTreeDataProvider('codesage.searchResults', searchResultsProvider);

  // Helper to get API client (starts backend if needed)
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

  // Helper to open graph panel with function
  function showFunctionInGraph(func: FunctionInfo) {
    getClient().then(client => {
      const panel = GraphPanel.createOrShow(context.extensionUri, client);
      panel.showFunctionCallGraph(func, 'forward');
    });
  }

  // Helper to open graph panel with variable
  function showVariableInGraph(variable: GlobalVarInfo) {
    getClient().then(client => {
      const panel = GraphPanel.createOrShow(context.extensionUri, client);
      panel.showVariableDataFlow(variable);
    });
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('codeSage.configureProject', () => {
      configureProject();
    }),

    vscode.commands.registerCommand('codeSage.parseProject', async () => {
      const client = await getClient();
      parseProject(client);
    }),

    vscode.commands.registerCommand('codeSage.cancelParse', async () => {
      const client = await getClient();
      cancelParse(client);
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

  // Watch for config changes
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
