import * as vscode from 'vscode';

export class OutputService implements vscode.Disposable {
    private channel: vscode.OutputChannel;

    constructor(name: string) {
        this.channel = vscode.window.createOutputChannel(name);
    }

    public getChannel(): vscode.OutputChannel {
        return this.channel;
    }

    public log(message: string, isLine: boolean = true): void {
        const config = vscode.workspace.getConfiguration('fv1');
        const showOutputWindow: boolean | undefined = config.get<boolean>('autoShowOutputWindow');
        if (showOutputWindow ?? true) this.channel.show(true);
        isLine ? this.channel.appendLine(message) : this.channel.append(message);
    }

    public dispose(): void {
        this.channel.dispose();
    }
}