import * as vscode from 'vscode';
import { logger } from '../logger';
import { ApiClient, GlobalVarInfo } from '../apiClient';

export async function searchVariable(
  client: ApiClient,
  onSelect: (variable: GlobalVarInfo) => void
): Promise<void> {
  logger.info('searchVariable command executed');

  const query = await vscode.window.showInputBox({
    prompt: '输入全局变量名搜索',
    placeHolder: '例如: jiffies, nr_cpus, global_config',
  });

  if (!query) return;

  try {
    const results = await client.searchVariables(query);

    if (results.length === 0) {
      vscode.window.showInformationMessage(`未找到匹配 "${query}" 的全局变量`);
      return;
    }

    const items = results.map(v => ({
      label: v.name,
      description: `${v.type} — ${v.module}`,
      detail: `${v.file}:${v.line}${v.is_extern ? ' [extern]' : ''}`,
      variable: v,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '选择全局变量查看数据流',
      matchOnDescription: true,
    });

    if (selected) {
      logger.info('Variable selected', { name: selected.variable.name, usr: selected.variable.usr });

      const action = await vscode.window.showQuickPick([
        { label: '查看数据流图', value: 'dataflow' },
        { label: '跳转到定义', value: 'goto' },
      ], { placeHolder: '选择操作' });

      if (action?.value === 'goto') {
        const uri = vscode.Uri.file(selected.variable.file);
        const position = new vscode.Position(selected.variable.line - 1, 0);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, {
          selection: new vscode.Range(position, position),
        });
      } else if (action) {
        onSelect(selected.variable);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`搜索失败: ${msg}`);
    logger.error('Search variable failed', msg);
  }
}
