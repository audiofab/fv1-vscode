import * as vscode from 'vscode';
import * as path from 'path';

export type SpnSlot = { slot: number; path: string };

export class SpnBankProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.TreeDragAndDropController<vscode.TreeItem> {
  public dropMimeTypes = ['text/uri-list'];
  public dragMimeTypes = ['text/uri-list'];
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: vscode.Uri | undefined) {}

  refresh(): void { this._onDidChangeTreeData.fire(); }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!this.workspaceRoot) return [];
    if (!element) {
      const files = await vscode.workspace.findFiles('**/*.spnbank', '**/node_modules/**');
      return files.map(f => {
        const item = new vscode.TreeItem(vscode.workspace.asRelativePath(f), vscode.TreeItemCollapsibleState.Collapsed);
        item.resourceUri = f;
        item.contextValue = 'spnBank';
        return item;
      });
    }
    if (element.resourceUri && element.contextValue === 'spnBank') {
      try {
        const doc = await vscode.workspace.openTextDocument(element.resourceUri);
        const json = doc.getText() ? JSON.parse(doc.getText()) : {};
        const slots = Array.isArray(json.slots) ? json.slots : new Array(8).fill(null).map((_, i) => ({ slot: i+1, path: '' }));
        return slots.map((s: any) => {
          const label = `Program ${s.slot}`;
          const it = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
          const assigned = s.path ? s.path : '';
          it.iconPath = assigned ? new vscode.ThemeIcon('cloud-upload') : new vscode.ThemeIcon('file');
          it.description = assigned ? `${assigned}   ×` : 'Unassigned';
          it.command = assigned ? { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(path.resolve(path.dirname(element.resourceUri!.fsPath), s.path))] } : undefined;
          (it as any).bankUri = element.resourceUri;
          (it as any).slot = s.slot;
          (it as any).assignedPath = s.path;
          it.contextValue = 'spnSlot';
          return it;
        });
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> { return element; }

  async handleDrop(target: vscode.TreeItem | undefined, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
    if (!target) return;
    const itemSlot = (target as any).slot as number | undefined;
    const bankUri = (target as any).bankUri as vscode.Uri | undefined;
    if (!bankUri || !itemSlot) return;
    // Try various transfer types commonly used by Explorer and external drags
    const tryKeys = ['text/uri-list', 'application/vnd.code.tree.explorer', 'text/plain'];
    let raw: string | undefined;
    for (const k of tryKeys) {
      const d = dataTransfer.get(k);
      if (d) {
        try {
          raw = await d.asString();
        } catch (e) {
          raw = undefined;
        }
        if (raw) break;
      }
    }
    if (!raw) return;
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const uris = lines.map(l => {
      const candidate = l.split(/,\s*/)[0];
      try { return vscode.Uri.parse(candidate); } catch (e) { return vscode.Uri.file(candidate); }
    }).filter(u => !!u);
    if (uris.length === 0) return;
    const fileUri = uris[0];
    // Restrict to .spn files only
    if (!fileUri.fsPath.toLowerCase().endsWith('.spn')) {
      vscode.window.showWarningMessage('Only .spn files can be assigned to slots');
      return;
    }
    const bankDir = path.dirname(bankUri.fsPath);
    let rel = path.relative(bankDir, fileUri.fsPath);
    if (!rel || rel === '') rel = path.basename(fileUri.fsPath);
    try {
      const doc = await vscode.workspace.openTextDocument(bankUri);
      const json = doc.getText() ? JSON.parse(doc.getText()) : {};
      json.slots = json.slots || new Array(8).fill(null).map((_, i) => ({ slot: i+1, path: '' }));
      json.slots[itemSlot - 1] = { slot: itemSlot, path: rel };
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
      edit.replace(bankUri, fullRange, JSON.stringify(json, null, 2));
      await vscode.workspace.applyEdit(edit);
      await vscode.workspace.saveAll(false);
      this.refresh();
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to assign slot: ${e}`);
    }
  }

  dispose(): void {}
}
