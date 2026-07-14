import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const OPEN_MARKER_PREFIX = 'open-workspace-';
const OPEN_MARKER_MAX_AGE_MS = 2 * 60 * 1000;
const OPEN_MARKER_HEARTBEAT_MS = 30 * 1000;

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
		const parsed = vscode.Uri.parse(uri);
		return parsed.scheme === 'file' ? parsed.fsPath : uri;
	} catch {
		return uri;
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
		const isUntitled = !wsPath.toLowerCase().endsWith('.code-workspace');
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
				out.push(path.resolve(parent, entry.path));
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

interface OpenWorkspaceMarker {
	pid: number;
	hash: string;
	updatedAt: number;
}

function markerPath(context: vscode.ExtensionContext, hash: string): string {
	return path.join(
		context.globalStorageUri.fsPath,
		`${OPEN_MARKER_PREFIX}${process.pid}-${hash}.json`
	);
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error: any) {
		return error?.code === 'EPERM';
	}
}

/** Register this window so other extension hosts can exclude its storage. */
export function registerOpenWorkspace(context: vscode.ExtensionContext): vscode.Disposable {
	const hash = getCurrentHash(context);
	if (!hash) {
		return new vscode.Disposable(() => undefined);
	}

	const file = markerPath(context, hash);
	const writeMarker = (): void => {
		try {
			fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
			const marker: OpenWorkspaceMarker = { pid: process.pid, hash, updatedAt: Date.now() };
			fs.writeFileSync(file, JSON.stringify(marker), 'utf8');
		} catch {
			// The current workspace is still excluded directly by the caller.
		}
	};

	writeMarker();
	const heartbeat = setInterval(writeMarker, OPEN_MARKER_HEARTBEAT_MS);
	return new vscode.Disposable(() => {
		clearInterval(heartbeat);
		try {
			fs.unlinkSync(file);
		} catch {
			/* already removed or storage unavailable */
		}
	});
}

/** Return workspace hashes registered by other live VS Code windows. */
export async function getOpenHashes(context: vscode.ExtensionContext): Promise<Set<string>> {
	const open = new Set<string>();
	let files: string[];
	try {
		files = fs.readdirSync(context.globalStorageUri.fsPath);
	} catch {
		return open;
	}

	for (const name of files) {
		if (!name.startsWith(OPEN_MARKER_PREFIX) || !name.endsWith('.json')) {
			continue;
		}
		const file = path.join(context.globalStorageUri.fsPath, name);
		try {
			const marker = JSON.parse(fs.readFileSync(file, 'utf8')) as OpenWorkspaceMarker;
			const fresh = Date.now() - marker.updatedAt <= OPEN_MARKER_MAX_AGE_MS;
			if (fresh && /^[0-9a-f]{32}$/.test(marker.hash) && isProcessRunning(marker.pid)) {
				open.add(marker.hash);
				continue;
			}
		} catch {
			/* remove malformed markers below */
		}
		try {
			fs.unlinkSync(file);
		} catch {
			/* best-effort stale marker cleanup */
		}
	}
	return open;
}
