import * as vscode from 'vscode';

// 2026-07-26 audit findings 16 and 17.
//
// Finding 16: every `sendText` call here ran `npx @gru953/studio ...` — the
// real published package is `@gru953/studio-cli` (see clients/cli/package.json),
// so this ran a package that doesn't exist and did nothing.
//
// Finding 17: `start`/`pause`/`resume` printed an encouraging message and
// then did nothing real — worse, `start` also created a `Dev-Memory` folder
// directly with `fs.mkdirSync`, entirely bypassing the actual studio
// coordinator that is supposed to own that folder's structure and content.
// Pausing and resuming a build is something the AI team does to Dev-Memory
// (deciding what to pick back up, recording state), which a standalone
// button cannot honestly perform — removed rather than faked. `status`
// stays: the CLI's own `status` command now reports real information (see
// clients/cli/src/status.js), so this button is no longer connected to a
// package that doesn't exist or a command that lies about doing something.
export function activate(context: vscode.ExtensionContext) {
    console.log('Universal Agentic Studio extension is now active!');

    const statusCommand = vscode.commands.registerCommand('gru953-studio.status', () => {
        vscode.window.showInformationMessage('Universal Agentic Studio: Fetching status...');
        const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('GRU953 Studio');
        terminal.show();
        terminal.sendText('npx @gru953/studio-cli status');
    });

    context.subscriptions.push(statusCommand);
}

// Nothing to clean up: the only registered command is disposed via
// context.subscriptions above, and no other resource is held.
export function deactivate(): void {
    // intentionally empty
}
