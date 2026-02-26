import * as vscode from 'vscode';
import WebSocket from 'ws';
import { logger } from '../logger';
import { ApiClient } from '../apiClient';
import { getConfig } from '../config';

export async function parseProject(client: ApiClient, statusBar?: vscode.StatusBarItem): Promise<void> {
  logger.info('parseProject command executed');

  const status = await client.getParseStatus();
  if (status.parsing) {
    vscode.window.showWarningMessage('解析正在进行中，请等待完成');
    return;
  }

  const confirm = await vscode.window.showInformationMessage(
    '开始解析项目源码？这可能需要较长时间。',
    '开始', '取消'
  );

  if (confirm !== '开始') return;

  const ownStatusBar = !statusBar;
  if (!statusBar) {
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  }

  try {
    await client.startParse();
    logger.info('Parse started successfully');

    const config = getConfig();
    statusBar.text = '$(sync~spin) CodeSage: 解析中...';
    statusBar.show();

    await new Promise<void>((resolve) => {
      let ws: WebSocket | null = null;
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };

      try {
        ws = new WebSocket(`ws://127.0.0.1:${config.backendPort}/ws`);
        ws.on('message', (data: Buffer) => {
          try {
            const progress = JSON.parse(data.toString());
            if (progress.status === 'running') {
              if (progress.percent !== undefined) {
                statusBar!.text = `$(sync~spin) CodeSage: [${progress.current}/${progress.total}] ${progress.percent}% ${progress.message}`;
              } else {
                statusBar!.text = `$(sync~spin) CodeSage: ${progress.message}`;
              }
              logger.debug('Parse progress', progress);
            } else if (progress.status === 'completed') {
              statusBar!.text = '$(check) CodeSage: 解析完成';
              const stats = progress.data || {};
              vscode.window.showInformationMessage(
                `解析完成！共 ${stats.total_functions || 0} 个函数，${stats.total_edges || 0} 条调用边，${stats.total_variables || 0} 个全局变量`
              );
              logger.info('Parse completed via WebSocket', stats);
              if (ownStatusBar) setTimeout(() => statusBar!.dispose(), 5000);
              ws?.close();
              done();
            } else if (progress.status === 'error') {
              statusBar!.text = '$(error) CodeSage: 解析出错';
              vscode.window.showErrorMessage(`解析出错: ${progress.message}`);
              logger.error('Parse error via WebSocket', progress.message);
              if (ownStatusBar) setTimeout(() => statusBar!.dispose(), 5000);
              ws?.close();
              done();
            }
          } catch { /* ignore parse errors */ }
        });
        ws.on('error', () => {
          logger.warn('WebSocket connection failed, falling back to polling');
          ws = null;
          pollUntilDone(client, statusBar!, ownStatusBar).then(done);
        });
        ws.on('close', () => done());
      } catch {
        pollUntilDone(client, statusBar!, ownStatusBar).then(done);
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`解析失败: ${msg}`);
    logger.error('Parse failed', msg);
  }
}

async function pollUntilDone(
  client: ApiClient,
  statusBar: vscode.StatusBarItem,
  disposeOnDone: boolean,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const pollInterval = setInterval(async () => {
      try {
        const s = await client.getParseStatus();
        if (!s.parsing) {
          clearInterval(pollInterval);
          const stats = await client.getStats();
          statusBar.text = '$(check) CodeSage: 解析完成';
          vscode.window.showInformationMessage(
            `解析完成！共 ${(stats as Record<string, number>).functions || 0} 个函数，${(stats as Record<string, number>).edges || 0} 条调用边，${(stats as Record<string, number>).variables || 0} 个全局变量`
          );
          logger.info('Parse completed', stats);
          if (disposeOnDone) setTimeout(() => statusBar.dispose(), 5000);
          resolve();
        }
      } catch {
        clearInterval(pollInterval);
        if (disposeOnDone) statusBar.dispose();
        resolve();
      }
    }, 3000);
  });
}

export async function cancelParse(client: ApiClient): Promise<void> {
  logger.info('cancelParse command executed');
  try {
    const result = await client.cancelParse();
    if (result.cancelled) {
      vscode.window.showInformationMessage('解析已取消');
    } else {
      vscode.window.showInformationMessage('当前没有正在进行的解析');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`取消解析失败: ${msg}`);
  }
}
