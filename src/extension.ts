import * as vscode from 'vscode';
import { SessionContentProvider, SCHEME } from './content';
import { SessionsViewProvider } from './view';

export function activate(context: vscode.ExtensionContext): void {
	const content = new SessionContentProvider();
	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(SCHEME, content)
	);

	const view = new SessionsViewProvider(context, content);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('chatRestore.sessionsView', view)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('chatRestore.searchSessions', () =>
			vscode.commands.executeCommand('chatRestore.sessionsView.focus')
		),
		vscode.commands.registerCommand('chatRestore.refresh', () => view.refresh())
	);
}

export function deactivate(): void {
	/* no-op */
}
