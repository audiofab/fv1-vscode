import * as vscode from 'vscode';

export class FV1QuickActionsProvider implements vscode.TreeDataProvider<QuickAction> {
    private _onDidChangeTreeData: vscode.EventEmitter<QuickAction | undefined | null | void> = new vscode.EventEmitter<QuickAction | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<QuickAction | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor() {}

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
                'Create a new visual block diagram',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'fv1.createBlockDiagram',
                    title: 'Create Block Diagram'
                },
                new vscode.ThemeIcon('circuit-board')
            ),
            new QuickAction(
                'New Program Bank',
                'Create a new .spnbank file',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'fv1.createSpnBank',
                    title: 'Create Program Bank'
                },
                new vscode.ThemeIcon('file-add')
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
        public readonly iconPath?: vscode.ThemeIcon
    ) {
        super(label, collapsibleState);
        this.tooltip = tooltip;
        this.command = command;
        this.iconPath = iconPath;
    }
}
