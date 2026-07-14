import * as fs from 'fs';

export interface Turn {
	user: string;
	assistant: string;
	modelId?: string;
	timestamp?: number;
}

export interface ParsedSession {
	sessionId: string;
	title: string;
	created?: number;
	turns: Turn[];
}

function mdText(x: any): string {
	if (typeof x === 'string') {
		return x;
	}
	if (x && typeof x === 'object' && typeof x.value === 'string') {
		return x.value;
	}
	return '';
}

/** Render the assistant's response parts into a single markdown string. */
function renderResponse(parts: any[]): string {
	const chunks: string[] = [];
	for (const p of parts) {
		if (!p || typeof p !== 'object') {
			continue;
		}
		const kind = p.kind;
		if (kind === undefined && typeof p.value === 'string') {
			// Plain markdown content part.
			chunks.push(p.value);
		} else if (kind === 'markdownContent') {
			chunks.push(mdText(p.content));
		} else if (kind === 'thinking') {
			const t = mdText(p.value).trim();
			if (t) {
				chunks.push(`> 🧠 _${t.replace(/\n/g, '\n> ')}_`);
			}
		} else if (kind === 'toolInvocationSerialized') {
			const msg = mdText(p.pastTenseMessage) || mdText(p.invocationMessage);
			if (msg) {
				chunks.push(`> 🔧 ${msg}`);
			}
		} else if (kind === 'inlineReference') {
			const name = p.name || (p.inlineReference && p.inlineReference.path);
			if (name) {
				chunks.push('`' + String(name) + '`');
			}
		}
	}
	return chunks.join('\n\n');
}

/** Parse a session .jsonl file into a readable model. */
export function parseSession(filePath: string, sessionId: string): ParsedSession {
	const result: ParsedSession = { sessionId, title: '', turns: [] };
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, 'utf8');
	} catch {
		return result;
	}

	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		let rec: any;
		try {
			rec = JSON.parse(trimmed);
		} catch {
			continue;
		}
		const kind = rec.kind;
		if (kind === 0) {
			const v = rec.v ?? {};
			result.created = v.creationDate ?? result.created;
			if (typeof v.customTitle === 'string') {
				result.title = v.customTitle;
			}
			for (const req of v.requests ?? []) {
				pushTurn(result, req);
			}
		} else if (kind === 1) {
			const keys: string[] = rec.k ?? [];
			if (keys.length === 1 && keys[0] === 'customTitle') {
				result.title = typeof rec.v === 'string' ? rec.v : result.title;
			}
		} else if (kind === 2) {
			const list = Array.isArray(rec.v) ? rec.v : [];
			for (const req of list) {
				if (req && typeof req === 'object' && 'message' in req) {
					pushTurn(result, req);
				}
			}
		}
	}

	if (!result.title) {
		result.title = result.turns[0]?.user.slice(0, 80) || '(untitled session)';
	}
	return result;
}

function pushTurn(result: ParsedSession, req: any): void {
	if (!req || typeof req !== 'object') {
		return;
	}
	const user = mdText(req.message) || mdText(req.message?.text) ||
		(typeof req.message?.text === 'string' ? req.message.text : '');
	const assistant = Array.isArray(req.response) ? renderResponse(req.response) : '';
	result.turns.push({
		user: user.trim(),
		assistant: assistant.trim(),
		modelId: req.modelId,
		timestamp: req.timestamp,
	});
}

/** Render a parsed session as a readable markdown document. */
export function renderMarkdown(session: ParsedSession, sourceLabel: string): string {
	const lines: string[] = [];
	lines.push(`# ${session.title}`);
	lines.push('');
	lines.push(`> Source: ${sourceLabel}  `);
	lines.push(`> Session ID: \`${session.sessionId}\`  `);
	if (session.created) {
		lines.push(`> Created: ${new Date(session.created).toLocaleString()}  `);
	}
	lines.push(`> Turns: ${session.turns.length}`);
	lines.push('');
	lines.push('---');
	lines.push('');

	session.turns.forEach((turn, i) => {
		lines.push(`## 👤 User (${i + 1})`);
		lines.push('');
		lines.push(turn.user || '_(empty)_');
		lines.push('');
		const model = turn.modelId ? ` · \`${turn.modelId}\`` : '';
		lines.push(`## 🤖 Assistant${model}`);
		lines.push('');
		lines.push(turn.assistant || '_(no textual response captured)_');
		lines.push('');
		lines.push('---');
		lines.push('');
	});

	return lines.join('\n');
}
