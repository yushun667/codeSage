import * as vscode from 'vscode';
import { logger } from '../logger';
import { FunctionInfo, GlobalVarInfo } from '../apiClient';

type SearchItem = FunctionInfo | GlobalVarInfo;

class SearchResultItem extends vscode.TreeItem {
  constructor(
    public readonly data: SearchItem,
    public readonly itemType: 'function' | 'variable'
  ) {
    const name = data.name;
    super(name, vscode.TreeItemCollapsibleState.None);

    if (itemType === 'function') {
      const func = data as FunctionInfo;
      this.description = `${func.module} — ${func.file}:${func.line}`;
      this.tooltip = func.signature || func.usr;
      this.iconPath = new vscode.ThemeIcon('symbol-function');
      this.command = {
        command: 'codeSage.showFunctionGraph',
        title: '查看调用链',
        arguments: [func],
      };
    } else {
      const variable = data as GlobalVarInfo;
      this.description = `${variable.type} — ${variable.file}:${variable.line}`;
      this.tooltip = `${variable.is_extern ? 'extern ' : ''}${variable.type} ${variable.name}`;
      this.iconPath = new vscode.ThemeIcon('symbol-variable');
      this.command = {
        command: 'codeSage.showVariableDataFlow',
        title: '查看数据流',
        arguments: [variable],
      };
    }
  }
}

export class SearchResultsProvider implements vscode.TreeDataProvider<SearchResultItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SearchResultItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: SearchResultItem[] = [];

  setFunctionResults(results: FunctionInfo[]): void {
    logger.debug('setFunctionResults', { count: results.length });
    this.items = results.map(f => new SearchResultItem(f, 'function'));
    this._onDidChangeTreeData.fire(undefined);
  }

  setVariableResults(results: GlobalVarInfo[]): void {
    logger.debug('setVariableResults', { count: results.length });
    this.items = results.map(v => new SearchResultItem(v, 'variable'));
    this._onDidChangeTreeData.fire(undefined);
  }

  clear(): void {
    this.items = [];
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SearchResultItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SearchResultItem[] {
    return this.items;
  }
}
