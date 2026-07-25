"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
function activate(context) {
    console.log('Universal Agentic Studio extension is now active!');
    let startCommand = vscode.commands.registerCommand('gru953-studio.start', () => {
        vscode.window.showInformationMessage('Universal Agentic Studio starting...');
        // TODO: Bridge logic to agentic platform
    });
    let statusCommand = vscode.commands.registerCommand('gru953-studio.status', () => {
        vscode.window.showInformationMessage('Universal Agentic Studio status request...');
        // TODO: Bridge logic to agentic platform
    });
    let pauseCommand = vscode.commands.registerCommand('gru953-studio.pause', () => {
        vscode.window.showInformationMessage('Universal Agentic Studio paused.');
        // TODO: Bridge logic to agentic platform
    });
    let resumeCommand = vscode.commands.registerCommand('gru953-studio.resume', () => {
        vscode.window.showInformationMessage('Universal Agentic Studio resuming...');
        // TODO: Bridge logic to agentic platform
    });
    context.subscriptions.push(startCommand, statusCommand, pauseCommand, resumeCommand);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map