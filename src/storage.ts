import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import * as vscode from 'vscode';

/** Kind of workspace a storage dir represents. */
export type WorkspaceKind = 'folder' | 'workspace-file' | 'untitled' | 'empty' | 'unknown';

export interface StorageInfo {
	/** The 32-char storage hash (folder name under workspaceStorage). */
	hash: string;
	/** Absolute path to the storage directory. */
	dir: string;
	kind: WorkspaceKind;
	/** Human-friendly label describing the workspace this storage belonged to. */
	label: string;
	/** Folder paths this workspace contained (for folder/untitled/workspace-file). */
	folders: string[];
	/**
	 * What to hand to `vscode.openFolder`: a single folder path, a
	 * `.code-workspace` file, or an untitled workspace file. Undefined when the
	 * workspace can't be reopened (e.g. empty window).
	 */
	openTarget?: string;
	/** True when openTarget is a workspace file rather than a plain folder. */
	openTargetIsWorkspaceFile: boolean;
}

/**
 * Locate the VS Code `User` directory from the extension's global storage URI.
 * globalStorageUri looks like: <...>/User/globalStorage/<publisher.name>
 * so two levels up is the `User` directory. This is robust across
 * stable/Insiders and all operating systems.
 */
export function getUserDir(context: vscode.ExtensionContext): string {
	return path.dirname(path.dirname(context.globalStorageUri.fsPath));
}

export function getWorkspaceStorageBase(context: vscode.ExtensionContext): string {
	return path.join(getUserDir(context), 'workspaceStorage');
}

/** The storage hash of the currently open workspace, if any. */
export function getCurrentHash(context: vscode.ExtensionContext): string | undefined {
	if (!context.storageUri) {
		return undefined;
	}
	return path.basename(context.storageUri.fsPath);
}

function decodeFileUri(uri: string): string {
	try {
		return decodeURIComponent(uri.replace(/^file:\/\//, ''));
	} catch {
		return uri.replace(/^file:\/\//, '');
	}
}

/** Read and classify a single storage directory via its workspace.json. */
export function classifyStorage(userDir: string, dir: string): StorageInfo {
	const hash = path.basename(dir);
	const wsJson = path.join(dir, 'workspace.json');
	const base: StorageInfo = {
		hash,
		dir,
		kind: 'unknown',
		label: hash,
		folders: [],
		openTargetIsWorkspaceFile: false,
	};

	let content: any;
	try {
		content = JSON.parse(fs.readFileSync(wsJson, 'utf8'));
	} catch {
		// No workspace.json -> likely an empty-window storage.
		base.kind = 'empty';
		base.label = '(empty window)';
		return base;
	}

	if (typeof content.folder === 'string') {
		const p = decodeFileUri(content.folder);
		base.kind = 'folder';
		base.folders = [p];
		base.label = path.basename(p) || p;
		base.openTarget = p;
		return base;
	}

	if (typeof content.workspace === 'string') {
		const wsPath = decodeFileUri(content.workspace);
		// Saved multi-root workspaces are `.code-workspace` files; untitled
		// workspaces are generated `workspace.json` files under the app's
		// `Workspaces/` store.
		const isUntitled = !wsPath.endsWith('.code-workspace');
		base.folders = readWorkspaceFileFolders(wsPath);
		base.openTarget = wsPath;
		base.openTargetIsWorkspaceFile = true;
		if (isUntitled) {
			base.kind = 'untitled';
			const names = base.folders.map((f) => path.basename(f)).filter(Boolean);
			base.label = names.length
				? `untitled workspace (${names.join(', ')})`
				: 'untitled workspace';
		} else {
			base.kind = 'workspace-file';
			base.label = `${path.basename(wsPath)} (multi-root)`;
		}
		return base;
	}

	base.kind = 'empty';
	base.label = '(empty window)';
	return base;
}

/** Read the folder paths listed inside a .code-workspace / untitled workspace file. */
function readWorkspaceFileFolders(wsPath: string): string[] {
	try {
		const raw = JSON.parse(fs.readFileSync(wsPath, 'utf8'));
		const parent = path.dirname(wsPath);
		const out: string[] = [];
		for (const entry of raw.folders ?? []) {
			if (typeof entry.path === 'string') {
				out.push(path.normalize(path.join(parent, entry.path)));
			} else if (typeof entry.uri === 'string') {
				out.push(decodeFileUri(entry.uri));
			}
		}
		return out;
	} catch {
		return [];
	}
}

/** List all workspace storages. */
export function listStorages(context: vscode.ExtensionContext): StorageInfo[] {
	const base = getWorkspaceStorageBase(context);
	const userDir = getUserDir(context);
	let entries: string[];
	try {
		entries = fs.readdirSync(base);
	} catch {
		return [];
	}
	const out: StorageInfo[] = [];
	for (const entry of entries) {
		const dir = path.join(base, entry);
		try {
			if (!fs.statSync(dir).isDirectory()) {
				continue;
			}
		} catch {
			continue;
		}
		out.push(classifyStorage(userDir, dir));
	}
	return out;
}

/**
 * Best-effort detection of workspace storages that are currently open in a
 * running VS Code window, by inspecting which state.vscdb files are held open.
 * Uses `lsof` (macOS/Linux). Returns a set of storage hashes.
 */
export async function getOpenHashes(base: string): Promise<Set<string>> {
	const open = new Set<string>();
	if (process.platform === 'win32') {
		return open; // lsof unavailable; caller falls back to excluding current only.
	}
	return new Promise((resolve) => {
		execFile('lsof', ['-Fn', '+D', base], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
			// lsof exits non-zero when some files can't be accessed; still parse stdout.
			const text = stdout || '';
			const re = new RegExp(
				base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/([0-9a-f]{32})/',
				'g'
			);
			let m: RegExpExecArray | null;
			while ((m = re.exec(text)) !== null) {
				open.add(m[1]);
			}
			resolve(open);
		});
	});
}
