import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 2026-07-26 audit findings 16 and 17.
//
// Finding 16: every `sendText` call here ran `npx @gru953/studio ...` — the
// real published package is `@gru953/studio-cli` (see clients/cli/package.json),
// so this ran a package that doesn't exist and did nothing.
//
// 2026-07-29 maintenance fix (audit finding 1): `@gru953/studio-cli` had
// never actually been published to npm (confirmed 404 from the registry) and
// there was no publish step anywhere in .github/workflows/, so `npx
// @gru953/studio-cli status` — the fix that finding 16 above landed — could
// never have worked either. Replaced with a direct `node` invocation of the
// CLI's own entry file, located relative to this extension's own installed
// files the same way clients/antigravity/src/index.js locates
// plugins/gru953-studio.
//
// 2026-07-29 second maintenance pass (a follow-up review of the fix directly
// above — NOT the same numbered list as "audit finding 1" above it, to avoid
// exactly the kind of finding-number collision this project's comments
// otherwise take care to avoid): a packaged, normally-installed .vsix ships
// only out/, package.json, README.md and LICENSE (see .vscodeignore) —
// clients/cli/ can never be present there, so `cliEntry` below would resolve
// to a path that doesn't exist and `sendText` would run a command that
// crashes the integrated terminal with a raw Node "Cannot find module" stack
// trace. Guarded with fs.existsSync() before sending anything to the
// terminal; a plain-English error explained why instead.
//
// 2026-08-07 audit fix. BOTH premises of the two notes above are now stale,
// and the guard they justified had turned this extension into a no-op for
// every real user. Verified directly against the npm registry rather than
// assumed: `@gru953/studio-cli` IS published (5.0.1, 5.1.0, 5.1.1, 5.1.2),
// and `.github/workflows/publish.yml` IS the publish step — both landed in
// 5.1.0/5.1.2, after those comments were written. Meanwhile `.vscodeignore`
// guarantees clients/cli/ is never inside a packaged .vsix, so for anyone who
// installed this extension from the Marketplace the existsSync() guard always
// failed, and its single contributed command could do nothing but show an
// error saying it only works from a repository checkout. A published
// extension whose only command never runs is the same class of defect as
// finding 16 (a command wired to a package that does not exist), just
// reached from the other direction.
//
// So: prefer the local checkout when it genuinely is one — that is faster,
// works offline, and is what a contributor developing this repo wants — and
// otherwise fall back to `npx` against the now-published package, which is
// what the original finding-16 fix intended and what now actually works.
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
        const runningFromCheckout = fs.existsSync(cliEntry);
        // `--yes` so npx never stops at an interactive "install this package?"
        // prompt: this runs in a terminal the user did not type into, where a
        // silent wait for a keypress reads exactly like a hang.
        const command = runningFromCheckout
            ? `node "${cliEntry}" status`
            : 'npx --yes @gru953/studio-cli status';
        vscode.window.showInformationMessage(
            runningFromCheckout
                ? 'GRU953-Studio: Fetching status...'
                : 'GRU953-Studio: Fetching status via npx (first run may take a moment to download the CLI)...',
        );
        const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('GRU953 Studio');
        terminal.show();
        terminal.sendText(command);
    });

    context.subscriptions.push(statusCommand);
}

// Nothing to clean up: the only registered command is disposed via
// context.subscriptions above, and no other resource is held.
export function deactivate(): void {
    // intentionally empty
}
