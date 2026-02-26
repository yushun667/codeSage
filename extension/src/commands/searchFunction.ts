import * as vscode from 'vscode';
import { logger } from '../logger';
import { ApiClient, FunctionInfo } from '../apiClient';
import { SearchResultsProvider } from '../views/searchResultsProvider';

export async function searchFunction(
  client: ApiClient,
  resultsProvider: SearchResultsProvider,
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
      resultsProvider.clear();
      return;
    }

    resultsProvider.setFunctionResults(results);
    // Reveal the sidebar panel
    await vscode.commands.executeCommand('codesage.searchResults.focus');
    logger.info(`Found ${results.length} functions for "${query}"`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`搜索失败: ${msg}`);
    logger.error('Search function failed', msg);
  }
}
