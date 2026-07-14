import * as vscode from 'vscode';
import * as fs from 'fs';
import { SessionHit } from './search';
import { StorageInfo } from './storage';
import { parseSession, renderMarkdown } from './parse';

export const SCHEME = 'chatrestore';

/** Provides read-only markdown rendering of a session on demand. */
export class SessionContentProvider implements vscode.TextDocumentContentProvider {
	private readonly hits = new Map<string, SessionHit>();

	register(hit: SessionHit): vscode.Uri {
		const key = `${hit.storage.hash}_${hit.sessionId}`;
		this.hits.set(key, hit);
		const safeTitle = hit.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
		return vscode.Uri.parse(`${SCHEME}:${safeTitle}.md`).with({ query: key });
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		const hit = this.hits.get(uri.query);
		if (!hit) {
			return '# Session not found';
		}
		const parsed = parseSession(hit.filePath, hit.sessionId);
		return renderMarkdown(parsed, hit.storage.label);
	}
}

/** Open a session as a read-only rendered markdown document. */
export async function openSession(
	provider: SessionContentProvider,
	hit: SessionHit
): Promise<void> {
	const uri = provider.register(hit);
	const doc = await vscode.workspace.openTextDocument(uri);
	await vscode.languages.setTextDocumentLanguage(doc, 'markdown');
	await vscode.window.showTextDocument(doc, { preview: true });
}

/**
 * Reopen the workspace a session belonged to in a new window. Because the
 * session lives in that workspace's storage, it becomes visible natively there.
 */
export async function openWorkspace(storage: StorageInfo): Promise<void> {
	if (!storage.openTarget) {
		vscode.window.showWarningMessage(
			`This session's workspace can't be reopened (${storage.label}).`
		);
		return;
	}
	if (!fs.existsSync(storage.openTarget)) {
		vscode.window.showWarningMessage(
			`The original workspace no longer exists on disk:\n${storage.openTarget}`
		);
		return;
	}
	const uri = vscode.Uri.file(storage.openTarget);
	await vscode.commands.executeCommand('vscode.openFolder', uri, {
		forceNewWindow: true,
	});
}
