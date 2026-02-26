import * as vscode from 'vscode';
import { logger } from '../logger';
import { ApiClient } from '../apiClient';

export async function parseProject(client: ApiClient): Promise<void> {
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

  try {
    await client.startParse();
    vscode.window.showInformationMessage('解析已开始，请在输出面板查看进度');
    logger.info('Parse started successfully');

    // Poll for completion
    const pollInterval = setInterval(async () => {
      try {
        const s = await client.getParseStatus();
        if (!s.parsing) {
          clearInterval(pollInterval);
          const stats = await client.getStats();
          vscode.window.showInformationMessage(
            `解析完成！共 ${stats.functions || 0} 个函数，${stats.edges || 0} 条调用边，${stats.variables || 0} 个全局变量`
          );
          logger.info('Parse completed', stats);
        }
      } catch {
        clearInterval(pollInterval);
      }
    }, 3000);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`解析失败: ${msg}`);
    logger.error('Parse failed', msg);
  }
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
