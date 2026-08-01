import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 2026-07-26 audit findings 16 and 17.
//
// Finding 16: every `sendText` call here ran `npx @gru953/studio ...` — the
// real published package is `@gru953/studio-cli` (see clients/cli/package.json),
// so this ran a package that doesn't exist and did nothing.
//
// 2026-07-29 maintenance fix (audit finding 1): `@gru953/studio-cli` has
// never actually been published to npm (confirmed 404 from the registry) and
// there is no publish step anywhere in .github/workflows/, so `npx
// @gru953/studio-cli status` — the fix that finding 16 above landed — could
// never have worked either. Replaced with a direct `node` invocation of the
// CLI's own entry file, located relative to this extension's own installed
// files the same way clients/antigravity/src/index.js locates
// plugins/gru953-studio — i.e. this only works when the extension is running
// from inside a full GRU953-Studio checkout (as it is here), not from a
// standalone packaged .vsix with no sibling clients/cli/ directory.
//
// 2026-07-29 second maintenance pass (a follow-up review of the fix directly
// above — NOT the same numbered list as "audit finding 1" above it, to avoid
// exactly the kind of finding-number collision this project's comments
// otherwise take care to avoid): a packaged, normally-installed .vsix ships
// only out/, package.json, README.md and LICENSE (see .vscodeignore) —
// clients/cli/ can never be present there, so `cliEntry` below would resolve
// to a path that doesn't exist and `sendText` would run a command that
// crashes the integrated terminal with a raw Node "Cannot find module" stack
// trace — exactly the failure mode this project's own "never show a raw
// stack trace" rule exists to prevent. Guarded with fs.existsSync() before
// sending anything to the terminal; a plain-English error explains why
// instead.
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
    console.log('GRU953-Studio extension is now active!');

    const statusCommand = vscode.commands.registerCommand('gru953-studio.status', () => {
        const cliEntry = path.join(__dirname, '..', '..', '..', 'clients', 'cli', 'src', 'index.js');
        if (!fs.existsSync(cliEntry)) {
            vscode.window.showErrorMessage(
                'GRU953-Studio: Status needs a full GRU953-Studio checkout — this command only works when the extension is running from inside the repository (e.g. cloned for development), not from a normally-installed, packaged extension.',
            );
            return;
        }
        vscode.window.showInformationMessage('GRU953-Studio: Fetching status...');
        const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('GRU953 Studio');
        terminal.show();
        terminal.sendText(`node "${cliEntry}" status`);
    });

    context.subscriptions.push(statusCommand);
}

// Nothing to clean up: the only registered command is disposed via
// context.subscriptions above, and no other resource is held.
export function deactivate(): void {
    // intentionally empty
}
