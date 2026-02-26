import * as vscode from 'vscode';
import { logger } from '../logger';
import { ApiClient } from '../apiClient';
import { SearchResultsProvider } from '../views/searchResultsProvider';

export async function searchVariable(
  client: ApiClient,
  resultsProvider: SearchResultsProvider,
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
      resultsProvider.clear();
      return;
    }

    resultsProvider.setVariableResults(results);
    await vscode.commands.executeCommand('codesage.searchResults.focus');
    logger.info(`Found ${results.length} variables for "${query}"`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`搜索失败: ${msg}`);
    logger.error('Search variable failed', msg);
  }
}
