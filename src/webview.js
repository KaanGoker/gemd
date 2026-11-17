// The webview: a note opens in the live preview editor, an Obsidian Kanban file as a board (with a switch to text).
import { isKanban } from './kanban.mjs';
import { vscode, text, setText, note } from './shared.js';
import { showEditor, updateEditor, setNames, imageResolved, embedded, pasted, revealAnchor, toggleReading } from './preview.js';
import { showBoard, updateBoard, toolbar } from './board.js';
import { outlinePanel, setOutlineView } from './outline.js';

let view = null, mode = null, kanban = false, folds = [];
const bar = toolbar(() => setMode(mode === 'board' ? 'text' : 'board'));

function setMode(m) {
  mode = m;
  bar.show(kanban, m === 'board');
  if (m === 'board') { view = null; showBoard(); } else view = showEditor(folds);
  setOutlineView(view);
}

const font = px => document.documentElement.style.setProperty('--size', px + 'px');

window.addEventListener('message', ({ data: m }) => {
  if (m.type === 'init') {
    setText(m.text.replace(/\r\n/g, '\n'));
    kanban = isKanban(text);
    note.title = m.title || '';
    font(m.fontSize);
    folds = m.folds || [];
    outlinePanel(!!m.outline, bar.outline);
    setMode(kanban ? 'board' : 'text');
  } else if (m.type === 'update') {
    const next = m.text.replace(/\r\n/g, '\n');
    if (next === text) return;
    if (view) updateEditor(view, next); else updateBoard(next);
  } else if (m.type === 'font') {
    font(m.fontSize);
  } else if (m.type === 'names') {
    setNames(m.names);
  } else if (m.type === 'resolved') {
    imageResolved(m.name, m.src);
  } else if (m.type === 'embedded') {
    embedded(m.name, m.text);
  } else if (m.type === 'pasted') {
    pasted(view, m.name);
  } else if (m.type === 'reveal') {
    if (mode === 'board' && kanban) return;
    revealAnchor(view, m.sub);
  }
});

// Ctrl+E switches a note between editing and reading, like Obsidian; window-level so it works while read-only.
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e' && view) {
    e.preventDefault();
    toggleReading(view);
  }
});
vscode.postMessage({ type: 'ready' });
