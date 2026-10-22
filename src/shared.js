// What the preview and the board share: the host connection, the note text, inline Markdown, links.
import { TAG } from './kanban.mjs';

export const vscode = acquireVsCodeApi();
export const root = document.getElementById('root');

// The note text, always with \n; edits go out as line/character positions so CRLF files stay CRLF on the VS Code side.
export let text = '';
export const setText = t => { text = t; };
export const note = { title: '' };

export const open = target => vscode.postMessage({ type: 'open', target });
// A rendered link: `data-target` is a wikilink, `data-href` a Markdown link.
export const follow = a => a.dataset.target ? open(a.dataset.target) : vscode.postMessage({ type: 'external', href: a.dataset.href });

// Inline Markdown for table cells and cards: escaped first, so file text never becomes HTML.
export const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, t, a) => `<a data-target="${t}">${a || t}</a>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a data-href="$2">$1</a>')
    .replace(/@@\{(\d{1,2}:\d{2})\}/g, '<span class="time">$1</span>')
    .replace(/@\{(\d{4}-\d{2}-\d{2})\}/g, (_, d) => `<span class="date ${d < today() ? 'past' : d === today() ? 'now' : ''}">${d}</span>`)
    .replace(TAG, '$1<span class="tag">$2</span>');
}
