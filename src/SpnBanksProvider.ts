import * as vscode from 'vscode';
import * as path from 'path';

export type SpnSlot = { slot: number; path: string };

export class SpnBankProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.TreeDragAndDropController<vscode.TreeItem> {
  public dropMimeTypes = ['text/uri-list'];
  public dragMimeTypes = ['text/uri-list'];
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;
  private watcher?: vscode.FileSystemWatcher;
  private disposables: vscode.Disposable[] = [];
  private treeView?: vscode.TreeView<vscode.TreeItem>;

  constructor(private workspaceRoot: vscode.Uri | undefined) {
    // Watch for changes to .spnbank files and refresh automatically
    try {
      this.watcher = vscode.workspace.createFileSystemWatcher('**/*.spnbank');
      this.disposables.push(this.watcher);
      this.disposables.push(this.watcher.onDidCreate((uri) => this.onFileCreated(uri)));
      this.disposables.push(this.watcher.onDidChange((uri) => this.onFileChanged(uri)));
      this.disposables.push(this.watcher.onDidDelete((uri) => this.onFileDeleted(uri)));
    } catch (e) {
      // createFileSystemWatcher may throw in edge cases; ignore and continue without watcher
      console.error('Failed to create .spnbank watcher', e);
    }
  }

  refresh(): void { this._onDidChangeTreeData.fire(); }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!this.workspaceRoot) return [];
    if (!element) {
      let files = await vscode.workspace.findFiles('**/*.spnbank', '**/node_modules/**');
      // Stable deterministic ordering: sort by fsPath
      files = files.sort((a,b) => a.fsPath.localeCompare(b.fsPath));
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
        let slots = Array.isArray(json.slots) ? json.slots : new Array(8).fill(null).map((_, i) => ({ slot: i+1, path: '' }));
        // Sort slots by slot number to ensure stable ordering
        slots = slots.slice().sort((a:any,b:any) => (a.slot - b.slot));
        return slots.map((s: any) => {
          const label = `Program ${s.slot}`;
          const it = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
          const assigned = s.path ? s.path : '';
          it.iconPath = assigned ? new vscode.ThemeIcon('cloud-upload') : new vscode.ThemeIcon('file');
          it.description = assigned ? `${assigned}` : 'Unassigned';
          // provide an 'open' command when assigned
          it.command = assigned ? { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(path.resolve(path.dirname(element.resourceUri!.fsPath), s.path))] } : undefined;
          (it as any).bankUri = element.resourceUri;
          (it as any).slot = s.slot;
          (it as any).assignedPath = s.path;
          // set specific context value so menu can show unassign action for assigned slots
          it.contextValue = assigned ? 'spnSlotAssigned' : 'spnSlotUnassigned';
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
      // Load existing JSON (if any), update slots then write file directly to disk.
      const doc = await vscode.workspace.openTextDocument(bankUri);
      const json = doc.getText() ? JSON.parse(doc.getText()) : {};
      json.slots = json.slots || new Array(8).fill(null).map((_, i) => ({ slot: i+1, path: '' }));
      json.slots[itemSlot - 1] = { slot: itemSlot, path: rel };
      const newContent = Buffer.from(JSON.stringify(json, null, 2), 'utf8');
      await vscode.workspace.fs.writeFile(bankUri, newContent);
      // Refresh the provider so the tree shows the updated assignment
      this.refresh();
      // Try to reveal the bank and expand it; if slot info present, reveal the slot child too
      try {
        if (this.treeView) {
            const bankItem = new vscode.TreeItem(vscode.workspace.asRelativePath(bankUri), vscode.TreeItemCollapsibleState.Collapsed);
            bankItem.resourceUri = bankUri;
            await Promise.resolve(this.treeView.reveal(bankItem, { expand: true, focus: false, select: false }));
            // reveal the slot child if possible
            const slotItem = new vscode.TreeItem(`Program ${itemSlot}`, vscode.TreeItemCollapsibleState.None);
            (slotItem as any).bankUri = bankUri;
            (slotItem as any).slot = itemSlot;
            await Promise.resolve(this.treeView.reveal(slotItem, { expand: false, focus: false, select: true }));
          }
      } catch (e) {
        // reveal is best-effort; ignore errors
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to assign slot: ${e}`);
    }
  }

  /**
   * Set the TreeView instance so provider can reveal items on change.
   */
  setTreeView(view: vscode.TreeView<vscode.TreeItem>) {
    this.treeView = view;
  }

  private onFileCreated(uri: vscode.Uri) {
    this.refresh();
    // reveal the new bank if possible
    if (this.treeView) {
      const bankItem = new vscode.TreeItem(vscode.workspace.asRelativePath(uri), vscode.TreeItemCollapsibleState.Collapsed);
      bankItem.resourceUri = uri;
      // best-effort reveal
      Promise.resolve(this.treeView.reveal(bankItem, { expand: true, focus: false, select: true })).catch(() => {});
    }
  }

  private onFileChanged(uri: vscode.Uri) {
    this.refresh();
    // reveal the changed bank
    if (this.treeView) {
      const bankItem = new vscode.TreeItem(vscode.workspace.asRelativePath(uri), vscode.TreeItemCollapsibleState.Collapsed);
      bankItem.resourceUri = uri;
      Promise.resolve(this.treeView.reveal(bankItem, { expand: true, focus: false, select: false })).catch(() => {});
    }
  }

  private onFileDeleted(uri: vscode.Uri) {
    // refresh to remove deleted banks
    this.refresh();
  }

  dispose(): void {
    for (const d of this.disposables) {
      try { d.dispose(); } catch (e) { /* ignore */ }
    }
    this.disposables = [];
  }
}
