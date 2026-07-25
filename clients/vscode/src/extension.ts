import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('Universal Agentic Studio extension is now active!');

    function getWorkspaceDir(): string | undefined {
        const folders = vscode.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
    }

    let startCommand = vscode.commands.registerCommand('gru953-studio.start', () => {
        const workspaceDir = getWorkspaceDir();
        if (!workspaceDir) {
            vscode.window.showErrorMessage('Universal Agentic Studio requires an open workspace.');
            return;
        }

        const devMemoryPath = path.join(workspaceDir, 'Dev-Memory');
        if (!fs.existsSync(devMemoryPath)) {
            fs.mkdirSync(devMemoryPath);
            vscode.window.showInformationMessage('Initialized new Dev-Memory for Universal Agentic Studio.');
        } else {
            vscode.window.showInformationMessage('Found existing Dev-Memory. Resuming project...');
        }

        // Bridge logic: Trigger the agentic platform's start sequence
        const terminal = vscode.window.createTerminal('GRU953 Studio');
        terminal.show();
        terminal.sendText('echo "Triggering Universal Agentic Studio..."');
        terminal.sendText('npx @gru953/studio start');
    });

    let statusCommand = vscode.commands.registerCommand('gru953-studio.status', () => {
        vscode.window.showInformationMessage('Universal Agentic Studio: Fetching status...');
        const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('GRU953 Studio');
        terminal.show();
        terminal.sendText('npx @gru953/studio status');
    });

    let pauseCommand = vscode.commands.registerCommand('gru953-studio.pause', () => {
        vscode.window.showInformationMessage('Universal Agentic Studio paused.');
        const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('GRU953 Studio');
        terminal.show();
        terminal.sendText('npx @gru953/studio pause');
    });

    let resumeCommand = vscode.commands.registerCommand('gru953-studio.resume', () => {
        vscode.window.showInformationMessage('Universal Agentic Studio resuming...');
        const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('GRU953 Studio');
        terminal.show();
        terminal.sendText('npx @gru953/studio resume');
    });

    context.subscriptions.push(startCommand, statusCommand, pauseCommand, resumeCommand);
}

export function deactivate() {}
