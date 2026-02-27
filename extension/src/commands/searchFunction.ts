import * as vscode from 'vscode';
import { logger } from '../logger';
import { ApiClient, FunctionInfo } from '../apiClient';

export async function searchFunction(
  client: ApiClient,
  onSelect: (func: FunctionInfo) => void,
  initialQuery?: string,
): Promise<void> {
  logger.info('searchFunction command executed', initialQuery || '');

  const query = initialQuery || await vscode.window.showInputBox({
    prompt: '输入函数名搜索',
    placeHolder: '例如: schedule, kmalloc, process_data',
  });

  if (!query) return;

  try {
    const results = await client.searchFunctions(query);

    if (results.length === 0) {
      vscode.window.showInformationMessage(`未找到匹配 "${query}" 的函数`);
      return;
    }

    if (results.length === 1) {
      logger.info('Single result, opening graph directly', { name: results[0].name });
      onSelect(results[0]);
      return;
    }

    const items = results.map(f => ({
      label: f.name,
      description: `${f.module} — ${f.file}:${f.line}`,
      detail: f.signature || f.usr,
      func: f,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '选择函数查看调用图谱',
      matchOnDescription: true,
    });

    if (selected) {
      logger.info('Function selected', { name: selected.func.name, usr: selected.func.usr });
      onSelect(selected.func);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`搜索失败: ${msg}`);
    logger.error('Search function failed', msg);
  }
}
