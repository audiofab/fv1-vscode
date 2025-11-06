import * as vscode from 'vscode';
import * as path from 'path';

export class FV1QuickActionsProvider implements vscode.TreeDataProvider<QuickAction> {
    private _onDidChangeTreeData: vscode.EventEmitter<QuickAction | undefined | null | void> = new vscode.EventEmitter<QuickAction | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<QuickAction | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: QuickAction): vscode.TreeItem {
        return element;
    }

    getChildren(element?: QuickAction): Thenable<QuickAction[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const actions: QuickAction[] = [
            new QuickAction(
                'New Block Diagram',
                'Create a new block diagram program (.spndiagram)',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'fv1.createBlockDiagram',
                    title: 'Create Block Diagram'
                },
                {
                    light: vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'light', 'spndiagram-file.svg')),
                    dark: vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'dark', 'spndiagram-file.svg'))
                }
            ),
            new QuickAction(
                'New Program Bank',
                'Create a new program bank (.spnbank)',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'fv1.createSpnBank',
                    title: 'Create Program Bank'
                },
                {
                    light: vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'light', 'spnbank-file.svg')),
                    dark: vscode.Uri.file(path.join(this.context.extensionPath, 'resources', 'dark', 'spnbank-file.svg'))
                }
            ),
            new QuickAction(
                'Backup Pedal',
                'Backup your Easy Spin pedal',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'fv1.backupPedal',
                    title: 'Backup Pedal'
                },
                new vscode.ThemeIcon('cloud-download')
            )
        ];

        return Promise.resolve(actions);
    }
}

class QuickAction extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly tooltip: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        public readonly iconPath?: vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri }
    ) {
        super(label, collapsibleState);
        this.tooltip = tooltip;
        this.command = command;
        this.iconPath = iconPath;
    }
}
