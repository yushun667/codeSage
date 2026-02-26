import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../logger';
import { ApiClient, FunctionInfo, GlobalVarInfo } from '../apiClient';

export class GraphPanel {
  public static currentPanel: GraphPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private client: ApiClient;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: ApiClient) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.client = client;

    this.panel.webview.html = this.getHtmlContent();

    this.panel.webview.onDidReceiveMessage(
      async (message) => { await this.handleMessage(message); },
      null, this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    logger.info('GraphPanel created');
  }

  static createOrShow(extensionUri: vscode.Uri, client: ApiClient): GraphPanel {
    logger.info('GraphPanel.createOrShow');

    const column = vscode.ViewColumn.Beside;

    if (GraphPanel.currentPanel) {
      GraphPanel.currentPanel.panel.reveal(column);
      return GraphPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'codesage.graph',
      'CodeSage 图谱',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'webview', 'dist'),
        ],
      }
    );

    GraphPanel.currentPanel = new GraphPanel(panel, extensionUri, client);
    return GraphPanel.currentPanel;
  }

  async showFunctionCallGraph(func: FunctionInfo, direction: 'forward' | 'backward' = 'forward'): Promise<void> {
    logger.info('showFunctionCallGraph', { name: func.name, direction });

    try {
      const depth = 3;
      const response = direction === 'forward'
        ? await this.client.getForwardCallGraph(func.usr, depth)
        : await this.client.getBackwardCallGraph(func.usr, depth);

      this.panel.webview.postMessage({
        type: 'loadCallGraph',
        data: response,
        rootUsr: func.usr,
        direction,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`加载调用图失败: ${msg}`);
      logger.error('Failed to load call graph', msg);
    }
  }

  async showVariableDataFlow(variable: GlobalVarInfo): Promise<void> {
    logger.info('showVariableDataFlow', { name: variable.name });

    try {
      const response = await this.client.getVariableDataFlow(variable.usr, 3);

      this.panel.webview.postMessage({
        type: 'loadDataFlow',
        data: response,
        varUsr: variable.usr,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`加载数据流图失败: ${msg}`);
      logger.error('Failed to load data flow', msg);
    }
  }

  private async handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
    logger.debug('Webview message received', { type: message.type });

    switch (message.type) {
      case 'expandNode': {
        const usr = message.usr as string;
        const direction = (message.direction as string) || 'forward';
        try {
          const response = direction === 'forward'
            ? await this.client.getForwardCallGraph(usr, 1)
            : await this.client.getBackwardCallGraph(usr, 1);

          this.panel.webview.postMessage({
            type: 'addNodes',
            data: response,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Failed to expand node', msg);
        }
        break;
      }

      case 'openSource': {
        const file = message.file as string;
        const line = (message.line as number) || 1;
        try {
          const uri = vscode.Uri.file(file);
          const position = new vscode.Position(line - 1, 0);
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            selection: new vscode.Range(position, position),
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`无法打开文件: ${msg}`);
        }
        break;
      }

      case 'searchFunction': {
        const query = message.query as string;
        try {
          const results = await this.client.searchFunctions(query);
          this.panel.webview.postMessage({
            type: 'searchResults',
            data: results,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Webview search failed', msg);
        }
        break;
      }

      case 'searchVariable': {
        const query = message.query as string;
        try {
          const results = await this.client.searchVariables(query);
          this.panel.webview.postMessage({
            type: 'variableSearchResults',
            data: results,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Webview variable search failed', msg);
        }
        break;
      }

      case 'findPath': {
        const fromUsr = message.fromUsr as string;
        const toUsr = message.toUsr as string;
        try {
          const response = await this.client.findPath(fromUsr, toUsr);
          this.panel.webview.postMessage({
            type: 'loadCallGraph',
            data: response,
            rootUsr: fromUsr,
            direction: 'forward',
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`路径查询失败: ${msg}`);
          logger.error('Failed to find path', msg);
        }
        break;
      }

      case 'loadFunctionCallGraph': {
        const funcUsr = message.funcUsr as string;
        try {
          const response = await this.client.getForwardCallGraph(funcUsr, 3);
          this.panel.webview.postMessage({
            type: 'loadCallGraph',
            data: response,
            rootUsr: funcUsr,
            direction: 'forward',
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`加载调用图失败: ${msg}`);
          logger.error('Failed to load function call graph', msg);
        }
        break;
      }

      case 'loadVariableDataFlow': {
        const varUsr = message.varUsr as string;
        try {
          const response = await this.client.getVariableDataFlow(varUsr, 3);
          this.panel.webview.postMessage({
            type: 'loadDataFlow',
            data: response,
            varUsr,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`加载数据流图失败: ${msg}`);
          logger.error('Failed to load variable data flow', msg);
        }
        break;
      }
    }
  }

  private getHtmlContent(): string {
    const webviewDistUri = vscode.Uri.joinPath(this.extensionUri, 'webview', 'dist');
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(webviewDistUri, 'assets', 'index.js')
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(webviewDistUri, 'assets', 'index.css')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${this.panel.webview.cspSource} data:; font-src ${this.panel.webview.cspSource};">
  <title>CodeSage 图谱</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    logger.info('GraphPanel disposed');
    GraphPanel.currentPanel = undefined;

    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
