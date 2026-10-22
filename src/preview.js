// The note editor: CodeMirror with Obsidian-style live preview, tables, KaTeX math, wikilink completion.
import { EditorState, Annotation, StateField } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, WidgetType, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { autocompletion } from '@codemirror/autocomplete';
import katex from 'katex';
import { TAG, diffRange } from './kanban.mjs';
import { vscode, root, text, setText, follow, inline } from './shared.js';

const Remote = Annotation.define();
const images = new Map(), requested = new Set();
let names = [];

const hide = Decoration.replace({});
const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const CODE = new Set(['FencedCode', 'CodeBlock']);

class Check extends WidgetType {
  constructor(checked, pos) { super(); this.checked = checked; this.pos = pos; }
  eq(o) { return o.checked === this.checked && o.pos === this.pos; }
  toDOM(v) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-check';
    box.onmousedown = e => { e.preventDefault(); v.dispatch({ changes: { from: this.pos, to: this.pos + 1, insert: this.checked ? ' ' : 'x' } }); };
    return box;
  }
  ignoreEvent() { return true; }
}
class Text extends WidgetType {
  constructor(text, cls) { super(); this.text = text; this.cls = cls; }
  eq(o) { return o.text === this.text && o.cls === this.cls; }
  toDOM() { const s = document.createElement('span'); s.className = this.cls; s.textContent = this.text; return s; }
}
class Img extends WidgetType {
  constructor(name, width) { super(); this.name = name; this.width = width; }
  eq(o) { return o.name === this.name && o.width === this.width; }
  toDOM() {
    const img = document.createElement('img');
    img.className = 'cm-embed';
    img.dataset.name = this.name;
    if (this.width) img.style.width = this.width + 'px';
    img.alt = img.title = this.name;
    if (images.get(this.name)) img.src = images.get(this.name);
    else if (images.has(this.name)) img.classList.add('missing');
    else if (!requested.has(this.name)) { requested.add(this.name); vscode.postMessage({ type: 'resolve', name: this.name }); }
    return img;
  }
}

function frontMatterEnd(doc) {
  if (doc.line(1).text !== '---') return 0;
  for (let n = 2; n <= doc.lines; n++) if (doc.line(n).text === '---') return doc.line(n).to;
  return 0;
}

function build(v) {
  const { state } = v, doc = state.doc;
  const active = new Set();
  for (const r of state.selection.ranges) for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) active.add(n);
  const isActive = (from, to) => { for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) if (active.has(n)) return true; return false; };
  const out = [];
  const add = (from, to, deco) => out.push(deco.range(from, to));
  const line = (pos, cls) => add(doc.lineAt(pos).from, doc.lineAt(pos).from, Decoration.line({ class: cls }));
  const codeLines = new Set();
  const fm = frontMatterEnd(doc);
  for (let n = 1; fm && n <= doc.lineAt(fm).number; n++) line(doc.line(n).from, 'cm-fm');

  for (const { from, to } of v.visibleRanges) {
    syntaxTree(state).iterate({ from, to, enter: node => {
      if (node.to <= fm) return false;
      const name = node.name, on = isActive(node.from, node.to);
      const h = /^ATXHeading(\d)$/.exec(name);
      if (h) { line(node.from, 'cm-h cm-h' + h[1]); return; }
      if (CODE.has(name)) {
        for (let n = doc.lineAt(node.from).number; n <= doc.lineAt(node.to).number; n++) {
          codeLines.add(n);
          if (name === 'FencedCode') line(doc.line(n).from, 'cm-codeblock');
        }
        return false;
      }
      switch (name) {
        case 'HeaderMark':
          if (!on && node.node.parent.name.startsWith('ATX')) add(node.from, Math.min(node.to + 1, doc.lineAt(node.from).to), hide);
          return;
        case 'StrongEmphasis': add(node.from, node.to, Decoration.mark({ class: 'cm-strong' })); return;
        case 'Emphasis': add(node.from, node.to, Decoration.mark({ class: 'cm-em' })); return;
        case 'Strikethrough': add(node.from, node.to, Decoration.mark({ class: 'cm-strike' })); return;
        case 'InlineCode': add(node.from, node.to, Decoration.mark({ class: 'cm-code' })); return;
        case 'EmphasisMark': case 'StrikethroughMark':
          if (!on) add(node.from, node.to, hide);
          return;
        case 'CodeMark':
          if (!on && node.node.parent.name === 'InlineCode') add(node.from, node.to, hide);
          return;
        case 'Image': {
          const url = node.node.getChild('URL');
          if (on || !url) return false;
          const alt = doc.sliceString(node.from + 2, node.to).split('](')[0];
          const w = /\|(\d+)$/.exec(alt);
          add(node.from, node.to, Decoration.replace({ widget: new Img(doc.sliceString(url.from, url.to).replace(/^<|>$/g, ''), w ? w[1] : '') }));
          return false;
        }
        case 'Link': {
          const url = node.node.getChild('URL');
          const href = url ? doc.sliceString(url.from, url.to) : '';
          add(node.from, node.to, Decoration.mark({ class: 'cm-link', attributes: { 'data-href': href } }));
          if (!on) {
            for (const m of node.node.getChildren('LinkMark')) add(m.from, m.to, hide);
            if (url) add(url.from, url.to, hide);
          }
          return false;
        }
        case 'ListMark': {
          const task = node.node.parent.getChild('Task');
          if (on) return;
          if (task) add(node.from, Math.min(node.to + 1, task.from), hide);
          else if (/^[-*+]$/.test(doc.sliceString(node.from, node.to))) add(node.from, node.to, Decoration.replace({ widget: new Text('•', 'cm-bullet') }));
          return;
        }
        case 'TaskMarker': {
          const checked = doc.sliceString(node.from + 1, node.from + 2) !== ' ';
          if (checked && node.to + 1 < doc.lineAt(node.to).to) add(node.to + 1, doc.lineAt(node.to).to, Decoration.mark({ class: 'cm-done' }));
          if (!on) add(node.from, node.to, Decoration.replace({ widget: new Check(checked, node.from + 1) }));
          return;
        }
        case 'Blockquote': {
          const first = doc.lineAt(node.from), last = doc.lineAt(node.to);
          const c = /^>\s*\[!(\w+)\][+-]?\s*(.*)$/.exec(first.text);
          for (let n = first.number; n <= last.number; n++) {
            const l = doc.line(n);
            if (!l.text.startsWith('>')) continue;
            line(l.from, c ? `cm-callout cm-callout-${c[1].toLowerCase()}${n === first.number ? ' cm-callout-first' : ''}` : 'cm-quote');
            if (!active.has(n)) add(l.from, l.from + (l.text.startsWith('> ') ? 2 : 1), hide);
          }
          if (c && !on) {
            const s = first.from + first.text.indexOf('[!'), e = first.from + first.text.indexOf(']', s - first.from) + 1;
            const label = c[1][0].toUpperCase() + c[1].slice(1);
            add(s, Math.min(e + (c[2] ? 1 : 0), first.to), Decoration.replace({ widget: new Text(c[2] ? '' : label, 'cm-callout-title') }));
            if (c[2]) add(e, first.to, Decoration.mark({ class: 'cm-callout-title' }));
          }
          return;
        }
        case 'QuoteMark': return;
        case 'HorizontalRule':
          if (!on) { line(node.from, 'cm-hr'); add(node.from, node.to, hide); }
          return;
      }
    } });

    // Obsidian syntax the Markdown parser does not know: wikilinks, embeds, tags.
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
      if (codeLines.has(n)) continue;
      const l = doc.line(n);
      if (l.to <= fm) continue;
      const on = active.has(n);
      for (const m of l.text.matchAll(/(!?)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)) {
        const s = l.from + m.index, e = s + m[0].length, target = m[2].trim();
        if (m[1] && IMG.test(target) && !on) {
          add(s, e, Decoration.replace({ widget: new Img(target, /^\d+$/.test(m[3] || '') ? m[3] : '') }));
        } else if (on) {
          add(s, e, Decoration.mark({ class: 'cm-wikilink', attributes: { 'data-target': target } }));
        } else {
          const shown = m[3] !== undefined ? s + m[0].indexOf('|') + 1 : s + m[1].length + 2;
          add(s, shown, hide);
          add(shown, e - 2, Decoration.mark({ class: 'cm-wikilink', attributes: { 'data-target': target } }));
          add(e - 2, e, hide);
        }
      }
      if (!on && !l.text.trimStart().startsWith('$$')) for (const m of l.text.matchAll(INLINE_MATH)) {
        if ((l.text.slice(0, m.index).match(/`/g) || []).length % 2) continue;
        const s = l.from + m.index;
        add(s, s + m[0].length, Decoration.replace({ widget: new MathWidget(m[1], false, s) }));
      }
      if (/^#{1,6} /.test(l.text)) continue;
      for (const m of l.text.matchAll(TAG)) {
        const s = l.from + m.index + m[1].length;
        add(s, s + m[2].length, Decoration.mark({ class: 'cm-tag' }));
      }
    }
  }
  return Decoration.set(out, true);
}

// GitHub tables render as a real table while the cursor is outside; clicking a row puts the cursor on that line.
const cells = r => { let s = r.replace(/^\s*(>\s?)+/, '').trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1); return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|')); };
class Table extends WidgetType {
  constructor(src, from) { super(); this.src = src; this.from = from; }
  eq(o) { return o.src === this.src && o.from === this.from; }
  toDOM(v) {
    const rows = this.src.split('\n');
    const align = cells(rows[1] || '').map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : '');
    const wrap = document.createElement('div');
    wrap.className = 'cm-table-wrap';
    const table = document.createElement('table');
    const head = table.createTHead(), body = table.createTBody();
    rows.forEach((r, i) => {
      if (i === 1 || !r.trim()) return;
      const tr = (i ? body : head).insertRow();
      tr.dataset.line = i;
      cells(r).forEach((c, j) => {
        const td = document.createElement(i ? 'td' : 'th');
        td.innerHTML = withMath(c);
        if (align[j]) td.style.textAlign = align[j];
        tr.append(td);
      });
    });
    wrap.append(table);
    wrap.onmousedown = e => {
      e.preventDefault();
      const a = e.target.closest('[data-target],[data-href]');
      if (a) return follow(a);
      const n = v.state.doc.lineAt(this.from).number + Number(e.target.closest('tr')?.dataset.line || 0);
      v.dispatch({ selection: { anchor: v.state.doc.line(n).to } });
      v.focus();
    };
    return wrap;
  }
  ignoreEvent() { return true; }
}

// KaTeX math: `$...$` inline (not `$5 and $10`: no space inside the dollars, no digit after the closing one), `$$...$$` as a block.
class MathWidget extends WidgetType {
  constructor(src, display, from) { super(); this.src = src; this.display = display; this.from = from; }
  eq(o) { return o.src === this.src && o.display === this.display; }
  toDOM(v) {
    const box = document.createElement(this.display ? 'div' : 'span');
    box.className = this.display ? 'cm-math-block' : 'cm-math';
    box.innerHTML = katex.renderToString(this.src, { displayMode: this.display, throwOnError: false });
    box.onmousedown = e => { e.preventDefault(); v.dispatch({ selection: { anchor: this.from } }); v.focus(); };
    return box;
  }
  ignoreEvent() { return true; }
}
const INLINE_MATH = /(?<![\\$\w])\$(?=[^\s$])([^$`\n]*?[^\s\\$`])\$(?![\w$])/g;

// Inline Markdown with `$math$` rendered by KaTeX (table cells).
function withMath(s) {
  let out = '', last = 0;
  for (const m of s.matchAll(INLINE_MATH)) {
    out += inline(s.slice(last, m.index)) + katex.renderToString(m[1], { throwOnError: false });
    last = m.index + m[0].length;
  }
  return out + inline(s.slice(last));
}

// Block widgets (tables and `$$` math) must come from state, not from a view plugin.
function blocks(state) {
  const doc = state.doc, sel = state.selection.ranges, out = [], code = [];
  const outside = (from, to) => !sel.some(r => r.to >= from && r.from <= to);
  syntaxTree(state).iterate({ enter: n => {
    if (CODE.has(n.name)) { code.push([n.from, n.to]); return false; }
    if (n.name !== 'Table') return;
    const from = doc.lineAt(n.from).from, to = doc.lineAt(n.to).to;
    if (outside(from, to)) out.push(Decoration.replace({ widget: new Table(doc.sliceString(from, to), from), block: true }).range(from, to));
    return false;
  } });
  const inCode = pos => code.some(([a, b]) => pos >= a && pos <= b);
  for (let n = 1; n <= doc.lines; n++) {
    const l = doc.line(n);
    if (!l.text.trimStart().startsWith('$$') || inCode(l.from)) continue;
    let end = n;
    const one = l.text.trim();
    if (!(one.length > 4 && one.endsWith('$$'))) {
      while (end < doc.lines && !doc.line(end + 1).text.includes('$$')) end++;
      if (end === doc.lines) continue;
      end++;
    }
    const from = l.from, to = doc.line(end).to;
    if (outside(from, to)) {
      const src = doc.sliceString(from, to).trim().replace(/^\$\$|\$\$$/g, '');
      out.push(Decoration.replace({ widget: new MathWidget(src, true, from), block: true }).range(from, to));
    }
    n = end;
  }
  return Decoration.set(out, true);
}

const blockField = StateField.define({
  create: blocks,
  update: (v, tr) => tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? blocks(tr.state) : v,
  provide: f => EditorView.decorations.from(f),
});

// Ctrl+L like Obsidian: text -> `- [ ] text`, `- text` -> `- [ ] text`, then tick and untick.
function toggleTask(v) {
  const changes = [], seen = new Set();
  for (const r of v.state.selection.ranges) for (let n = v.state.doc.lineAt(r.from).number; n <= v.state.doc.lineAt(r.to).number; n++) {
    if (seen.has(n)) continue;
    seen.add(n);
    const l = v.state.doc.line(n), m = /^(\s*)([-*+] |\d+[.)] )?(\[[ xX]\](?: |$))?/.exec(l.text);
    const at = l.from + m[1].length + (m[2] || '').length;
    if (m[3]) changes.push({ from: at + 1, to: at + 2, insert: m[3][1] === ' ' ? 'x' : ' ' });
    else changes.push({ from: at, insert: m[2] ? '[ ] ' : '- [ ] ' });
  }
  const set = v.state.changes(changes);
  v.dispatch({ changes: set, selection: v.state.selection.map(set, 1) });
  return true;
}

const livePreview = ViewPlugin.fromClass(class {
  constructor(v) { this.decorations = build(v); }
  update(u) {
    if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view);
  }
}, { decorations: p => p.decorations });

// A click opens a link unless the cursor is on its line (then it edits); Ctrl+click always opens.
const clicks = EditorView.domEventHandlers({
  mousedown(e, v) {
    const el = e.target.closest('[data-target],[data-href]');
    if (!el) return false;
    const line = v.state.doc.lineAt(v.posAtDOM(el)).number;
    const raw = v.state.selection.ranges.some(r => v.state.doc.lineAt(r.head).number === line);
    if (raw && !(e.ctrlKey || e.metaKey)) return false;
    e.preventDefault();
    follow(el);
    return true;
  },
});

// `[[` offers every note name in the workspace; picking one closes the link unless `]]` is already there.
function wikiComplete(ctx) {
  const m = ctx.matchBefore(/\[\[[^\]|#\n]*/);
  if (!m || !names.length) return null;
  const apply = (v, c, from, to) => {
    const insert = v.state.sliceDoc(to, to + 2) === ']]' ? c.label : c.label + ']]';
    v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
  };
  return { from: m.from + 2, options: names.map(label => ({ label, apply })), validFor: /^[^\]|#\n]*$/ };
}

const toHost = EditorView.updateListener.of(u => {
  if (!u.docChanged || u.transactions.some(t => t.annotation(Remote))) return;
  const changes = [];
  u.changes.iterChanges((fromA, toA, _fb, _tb, ins) => {
    const a = u.startState.doc.lineAt(fromA), b = u.startState.doc.lineAt(toA);
    changes.push({ from: { line: a.number - 1, ch: fromA - a.from }, to: { line: b.number - 1, ch: toA - b.from }, insert: ins.toString() });
  });
  setText(u.state.doc.toString());
  vscode.postMessage({ type: 'edit', changes });
});

export function showEditor() {
  root.innerHTML = '';
  root.className = 'editor';
  const view = new EditorView({
    parent: root,
    state: EditorState.create({
      doc: text,
      extensions: [
        drawSelection(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        // Undo and redo belong to VS Code, which owns the document; swallow the keys so the browser does not undo too.
        keymap.of([{ key: 'Mod-l', run: toggleTask }, { key: 'Mod-z', run: () => true }, { key: 'Mod-y', run: () => true }, { key: 'Mod-Shift-z', run: () => true }, indentWithTab, ...searchKeymap, ...defaultKeymap]),
        search({ top: true }),
        autocompletion({ override: [wikiComplete], icons: false }),
        livePreview,
        blockField,
        clicks,
        toHost,
      ],
    }),
  });
  view.focus();
  return view;
}

// A change from outside: replace only the differing middle so the cursor stays where it was.
export function updateEditor(view, next) {
  const change = diffRange(view.state.doc.toString(), next);
  setText(next);
  view.dispatch({ changes: change, annotations: Remote.of(true) });
}

export const setNames = n => { names = n; };

export function imageResolved(name, src) {
  images.set(name, src);
  for (const img of document.querySelectorAll(`img[data-name="${CSS.escape(name)}"]`)) {
    if (src) img.src = src;
    else img.classList.add('missing');
  }
}
