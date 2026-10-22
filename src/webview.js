// The webview: a note opens in the live preview editor, an Obsidian Kanban file as a board (with a switch to text).
import { isKanban } from './kanban.mjs';
import { vscode, text, setText, note } from './shared.js';
import { showEditor, updateEditor, setNames, imageResolved } from './preview.js';
import { showBoard, updateBoard, toolbar } from './board.js';

let view = null, mode = null, kanban = false;
const bar = toolbar(() => setMode(mode === 'board' ? 'text' : 'board'));

function setMode(m) {
  mode = m;
  bar.show(kanban, m === 'board');
  if (m === 'board') { view = null; showBoard(); } else view = showEditor();
}

const font = px => document.documentElement.style.setProperty('--size', px + 'px');

window.addEventListener('message', ({ data: m }) => {
  if (m.type === 'init') {
    setText(m.text.replace(/\r\n/g, '\n'));
    kanban = isKanban(text);
    note.title = m.title || '';
    font(m.fontSize);
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
  }
});
vscode.postMessage({ type: 'ready' });
