import * as fs from 'fs';
import * as path from 'path';
import { StorageInfo } from './storage';

export interface SessionHit {
	sessionId: string;
	filePath: string;
	title: string;
	storage: StorageInfo;
	/** Session creation date (ms) parsed from the file; falls back to mtime. */
	created: number;
	mtime: number;
}

/** Extract title (customTitle) and creationDate from already-read file content. */
function extractMeta(content: string): { title: string; created: number } {
	let title = '';
	let created = 0;
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		// Only parse lines that could carry the metadata we need.
		if (!created && trimmed.indexOf('"creationDate"') < 0 && trimmed.indexOf('"customTitle"') < 0) {
			continue;
		}
		let rec: any;
		try {
			rec = JSON.parse(trimmed);
		} catch {
			continue;
		}
		if (rec.kind === 0 && rec.v) {
			if (typeof rec.v.creationDate === 'number') {
				created = rec.v.creationDate;
			}
			if (typeof rec.v.customTitle === 'string') {
				title = rec.v.customTitle;
			}
		} else if (rec.kind === 1 && Array.isArray(rec.k) && rec.k[0] === 'customTitle') {
			if (typeof rec.v === 'string') {
				title = rec.v;
			}
		}
	}
	return { title, created };
}

/**
 * Search chat sessions across the given storages for `query` (case-insensitive
 * substring). An empty query returns every session.
 */
export function searchSessions(query: string, storages: StorageInfo[]): SessionHit[] {
	// All-words (AND) match: every whitespace-separated term must appear
	// somewhere in the file, in any order, case-insensitively.
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const hits: SessionHit[] = [];

	for (const storage of storages) {
		const chatDir = path.join(storage.dir, 'chatSessions');
		let files: string[];
		try {
			files = fs.readdirSync(chatDir);
		} catch {
			continue;
		}
		for (const file of files) {
			if (!file.endsWith('.jsonl')) {
				continue;
			}
			const filePath = path.join(chatDir, file);
			let content = '';
			try {
				content = fs.readFileSync(filePath, 'utf8');
			} catch {
				continue;
			}
			if (terms.length) {
				const lower = content.toLowerCase();
				if (!terms.every((t) => lower.includes(t))) {
					continue;
				}
			}
			let mtime = 0;
			try {
				mtime = fs.statSync(filePath).mtimeMs;
			} catch {
				/* ignore */
			}
			const meta = extractMeta(content);
			hits.push({
				sessionId: path.basename(file, '.jsonl'),
				filePath,
				title: meta.title || '(untitled session)',
				storage,
				created: meta.created || mtime,
				mtime,
			});
		}
	}

	hits.sort((a, b) => b.created - a.created);
	return hits;
}
