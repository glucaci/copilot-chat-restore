import * as vscode from 'vscode';
import {
	getCurrentHash,
	getOpenHashes,
	listStorages,
	StorageInfo,
} from './storage';
import { searchSessions, SessionHit } from './search';
import { SessionContentProvider, openSession, openWorkspace } from './content';

interface ResultItem {
	id: string;
	title: string;
	description: string;
	detail: string;
	created: number;
	canOpen: boolean;
}

export class SessionsViewProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private storages?: StorageInfo[];
	private readonly hitsById = new Map<string, SessionHit>();

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly content: SessionContentProvider
	) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true };
		view.webview.html = this.html(view.webview);

		view.webview.onDidReceiveMessage(async (msg) => {
			switch (msg?.type) {
				case 'search':
					await this.doSearch(msg.query ?? '');
					break;
				case 'open': {
					const hit = this.hitsById.get(msg.id);
					if (hit) {
						await openSession(this.content, hit);
					}
					break;
				}
				case 'openWorkspace': {
					const hit = this.hitsById.get(msg.id);
					if (hit) {
						await openWorkspace(hit.storage);
					}
					break;
				}
			}
		});
	}

	/** Invalidate cached storage list and let the webview re-run its current query. */
	async refresh(): Promise<void> {
		this.storages = undefined;
		this.hitsById.clear();
		this.view?.webview.postMessage({ type: 'refresh' });
	}

	private async ensureStorages(): Promise<StorageInfo[]> {
		if (this.storages) {
			return this.storages;
		}
		const currentHash = getCurrentHash(this.context);
		const openHashes = await getOpenHashes(this.context);
		if (currentHash) {
			openHashes.add(currentHash);
		}
		this.storages = listStorages(this.context).filter((s) => !openHashes.has(s.hash));
		return this.storages;
	}

	private async doSearch(query: string): Promise<void> {
		if (!this.view) {
			return;
		}
		this.view.webview.postMessage({ type: 'searching' });
		const storages = await this.ensureStorages();
		const hits = searchSessions(query, storages);

		this.hitsById.clear();
		const items: ResultItem[] = hits.map((hit) => {
			const id = `${hit.storage.hash}_${hit.sessionId}`;
			this.hitsById.set(id, hit);
			return {
				id,
				title: hit.title,
				description: hit.storage.label,
				detail: new Date(hit.created).toLocaleString(),
				created: hit.created,
				canOpen: !!hit.storage.openTarget,
			};
		});
		this.view.webview.postMessage({ type: 'results', items });
	}

	private html(webview: vscode.Webview): string {
		const nonce = getNonce();
		const csp = [
			`default-src 'none'`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`script-src 'nonce-${nonce}'`,
		].join('; ');

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
	html, body { height: 100%; }
	body {
		padding: 0; margin: 0; display: flex; flex-direction: column;
		color: var(--vscode-foreground); font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
	}
	.header { flex: 0 0 auto; padding: 8px; background: var(--vscode-sideBar-background); }
	input {
		width: 100%; box-sizing: border-box; padding: 6px 8px;
		color: var(--vscode-input-foreground);
		background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, transparent);
		border-radius: 2px; outline: none;
	}
	input:focus { border-color: var(--vscode-focusBorder); }
	.toolbar { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 0.9em; }
	.toolbar label { opacity: 0.7; }
	select {
		flex: 1 1 auto; padding: 3px 6px; border-radius: 2px; outline: none;
		color: var(--vscode-dropdown-foreground);
		background: var(--vscode-dropdown-background);
		border: 1px solid var(--vscode-dropdown-border, transparent);
	}
	select:focus { border-color: var(--vscode-focusBorder); }

	/* Native-style indeterminate progress bar */
	.progress { flex: 0 0 auto; height: 2px; overflow: hidden; }
	.progress .bit {
		width: 100%; height: 100%; transform: translateX(-100%);
		background: var(--vscode-progressBar-background, #0e70c0);
	}
	.progress.active .bit { animation: sweep 1.3s infinite ease-in-out; }
	@keyframes sweep {
		0%   { transform: translateX(-100%) scaleX(0.4); }
		50%  { transform: translateX(0%)    scaleX(0.5); }
		100% { transform: translateX(100%)  scaleX(0.4); }
	}

	.status { flex: 0 0 auto; padding: 4px 10px; opacity: 0.7; font-size: 0.9em; }

	.listwrap { flex: 1 1 auto; position: relative; overflow: hidden; }
	.scroll { position: absolute; inset: 0; overflow-y: auto; }
	ul { list-style: none; margin: 0; padding: 0; }
	li {
		position: relative; padding: 6px 34px 6px 10px; cursor: pointer;
		border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
	}
	li:hover { background: var(--vscode-list-hoverBackground); }
	li:focus { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); outline: none; }
	.title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.desc { opacity: 0.85; font-size: 0.9em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.detail { opacity: 0.6; font-size: 0.82em; }
	.openbtn {
		position: absolute; top: 6px; right: 6px; display: none;
		width: 22px; height: 22px; padding: 0; line-height: 20px; text-align: center;
		border: none; border-radius: 3px; cursor: pointer; font-size: 14px;
		color: var(--vscode-foreground); background: transparent;
	}
	.openbtn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.2)); }
	li:hover .openbtn, li:focus .openbtn { display: block; }

	/* Dimming overlay + spinner shown while searching */
	.overlay {
		position: absolute; inset: 0; display: none;
		align-items: flex-start; justify-content: center; padding-top: 24px;
		background: var(--vscode-sideBar-background); opacity: 0.6;
	}
	.overlay.active { display: flex; }
	.spinner {
		width: 18px; height: 18px; border-radius: 50%;
		border: 2px solid var(--vscode-progressBar-background, #0e70c0);
		border-top-color: transparent; animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
	<div class="header">
		<input id="q" type="text" placeholder="Search sessions…" autofocus />
		<div class="toolbar">
			<label for="sort">Sort:</label>
			<select id="sort">
				<option value="newest">Date (newest first)</option>
				<option value="oldest">Date (oldest first)</option>
			</select>
		</div>
	</div>
	<div class="progress" id="progress"><div class="bit"></div></div>
	<div class="status" id="status">Type to search sessions.</div>
	<div class="listwrap">
		<div class="scroll"><ul id="list"></ul></div>
		<div class="overlay" id="overlay"><span class="spinner"></span></div>
	</div>
<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	const q = document.getElementById('q');
	const list = document.getElementById('list');
	const status = document.getElementById('status');
	const progress = document.getElementById('progress');
	const overlay = document.getElementById('overlay');
	const sort = document.getElementById('sort');
	let timer;
	let currentItems = [];

	function runSearch() {
		clearTimeout(timer);
		if (!q.value.trim()) {
			// Idle: don't search or show a loading indicator until the user types.
			setBusy(false);
			currentItems = [];
			list.innerHTML = '';
			status.textContent = 'Type to search sessions.';
			return;
		}
		vscode.postMessage({ type: 'search', query: q.value });
	}

	q.addEventListener('input', () => {
		clearTimeout(timer);
		timer = setTimeout(runSearch, 400);
	});
	q.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
	});
	sort.addEventListener('change', () => render(currentItems));

	function setBusy(busy) {
		progress.classList.toggle('active', busy);
		overlay.classList.toggle('active', busy);
	}

	function sortItems(items) {
		const asc = sort.value === 'oldest';
		return items.slice().sort((a, b) => asc ? a.created - b.created : b.created - a.created);
	}

	function render(items) {
		currentItems = items;
		list.innerHTML = '';
		if (!items.length) { status.textContent = 'No sessions found.'; return; }
		status.textContent = items.length + ' session(s)';
		for (const it of sortItems(items)) {
			const li = document.createElement('li');
			li.tabIndex = 0;
			li.innerHTML =
				'<div class="title"></div><div class="desc"></div><div class="detail"></div>';
			li.querySelector('.title').textContent = it.title;
			li.querySelector('.desc').textContent = it.description;
			li.querySelector('.detail').textContent = it.detail;
			const open = () => vscode.postMessage({ type: 'open', id: it.id });
			li.addEventListener('click', open);
			li.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
			if (it.canOpen) {
				const btn = document.createElement('button');
				btn.className = 'openbtn';
				btn.textContent = '↗';
				btn.title = 'Open this session\\'s workspace in a new window';
				btn.addEventListener('click', (e) => {
					e.stopPropagation();
					vscode.postMessage({ type: 'openWorkspace', id: it.id });
				});
				li.appendChild(btn);
			}
			list.appendChild(li);
		}
	}

	window.addEventListener('message', (e) => {
		const m = e.data;
		if (m.type === 'searching') { setBusy(true); status.textContent = 'Searching…'; }
		else if (m.type === 'results') { setBusy(false); render(m.items); }
		else if (m.type === 'refresh') { runSearch(); }
	});

	q.focus();
</script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}
