// The outline on the right, like Obsidian: headings as a tree, branches fold, a click jumps to the heading.
import { foldedRanges, unfoldEffect } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { headings, outlineTree } from './headings.mjs';
import { vscode, text } from './shared.js';

let panel = null, button = null, view = null, on = false, list = [], timer, picked = 0;
const closed = new Set(); // outline branches the user folded, by `level:text#n`

// Heading text as it reads, without Markdown marks.
const plain = s => s
  .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, t, a) => a || t)
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/(\*\*|__|\*|_|~~|==|`)(.+?)\1/g, '$2');

export function outlinePanel(open, btn) {
  on = open;
  button = btn;
  if (!panel) {
    panel = document.createElement('aside');
    panel.id = 'outline';
    document.body.append(panel);
  }
  button.onclick = () => { on = !on; vscode.postMessage({ type: 'outline', open: on }); apply(); };
  apply();
}

// The editor shows the outline; the board does not.
export function setOutlineView(v) {
  view = v;
  if (v) v.scrollDOM.addEventListener('scroll', mark, { passive: true });
  apply();
}

function apply() {
  const shown = on && !!view;
  panel.hidden = !shown;
  button.classList.toggle('on', shown);
  document.body.classList.toggle('outline-on', shown);
  if (shown) render();
}

export function outlineChanged() {
  if (!on || !view) return;
  clearTimeout(timer);
  timer = setTimeout(render, 150);
}

function render() {
  list = headings(text);
  const seen = new Map();
  const key = h => { const k = `${h.level}:${h.text}`; const n = (seen.get(k) || 0) + 1; seen.set(k, n); return `${k}#${n}`; };
  const item = (h, depth) => {
    const k = key(h), row = document.createElement('div'), kids = h.children.map(c => item(c, depth + 1));
    row.className = 'ol-item';
    row.dataset.line = h.line;
    row.style.paddingLeft = 6 + depth * 14 + 'px';
    const arrow = document.createElement('span');
    arrow.className = 'ol-arrow' + (closed.has(k) ? ' closed' : '');
    arrow.hidden = !kids.length;
    arrow.onclick = e => { e.stopPropagation(); closed.has(k) ? closed.delete(k) : closed.add(k); render(); };
    const label = document.createElement('span');
    label.textContent = plain(h.text);
    row.append(arrow, label);
    row.onclick = () => jump(h.line);
    const box = document.createElement('div');
    box.append(row);
    if (kids.length && !closed.has(k)) box.append(...kids);
    return box;
  };
  const title = document.createElement('div');
  title.className = 'ol-title';
  title.textContent = 'Outline';
  const tree = outlineTree(list).map(h => item(h, 0));
  panel.replaceChildren(title, ...(tree.length ? tree : [Object.assign(document.createElement('div'), { className: 'ol-empty', textContent: 'No headings' })]));
  mark();
}

// Open any fold that hides the heading, put the cursor on it and scroll it to the top.
function jump(n) {
  const line = view.state.doc.line(Math.min(n, view.state.doc.lines)), effects = [];
  foldedRanges(view.state).between(0, line.from, (from, to) => { if (from < line.from && to >= line.from) effects.push(unfoldEffect.of({ from, to })); });
  effects.push(EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }));
  picked = n;
  view.dispatch({ selection: { anchor: line.to }, effects });
  view.focus();
}

// The heading the reader is in: the last one above the top of the screen, or the one just jumped to while it is in sight
// (a heading near the end of the note cannot scroll to the top).
function mark() {
  if (!on || !view || panel.hidden) return;
  const box = view.scrollDOM.getBoundingClientRect(), at = y => view.state.doc.lineAt(view.lineBlockAtHeight(y - view.documentTop).from).number;
  const top = at(box.top + 40);
  if (picked && (picked < top || picked > at(box.bottom - 1))) picked = 0;
  let cur = picked;
  if (!cur) for (const h of list) if (h.line <= top) cur = h.line;
  for (const row of panel.querySelectorAll('.ol-item')) row.classList.toggle('current', +row.dataset.line === cur);
}
