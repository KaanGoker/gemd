// Obsidian Kanban boards: lanes, cards, menus, drag and drop, list and table views, the toolbar.
// Every action turns into kanban.mjs edits on the current text; the board then redraws from the new text.
import * as K from './kanban.mjs';
import { vscode, root, text, setText, note, follow, esc, inline, today } from './shared.js';

// Board edits: send, then apply locally, because the host does not echo our own edits back.
// An outside change that arrived while a board edit was open waits in `pendingText`; the edit is rebased onto it.
let pendingText = null;
const lineCh = (s, off) => {
  const before = s.slice(0, off);
  return { line: before.split('\n').length - 1, ch: off - (before.lastIndexOf('\n') + 1) };
};
function sendOffsets(s, changes) {
  if (!changes.length) return;
  if (pendingText != null) {
    const moved = K.rebase(changes, s, pendingText);
    setText(s = pendingText);
    pendingText = null;
    if (!moved) { vscode.postMessage({ type: 'warn', text: 'The file changed while you were editing that spot, so this edit was not applied.' }); showBoard(); return; }
    changes = moved;
  }
  vscode.postMessage({ type: 'edit', changes: changes.map(c => ({ from: lineCh(s, c.from), to: lineCh(s, c.to), insert: c.insert })) });
  setText(K.apply(s, changes));
  showBoard();
}
const edit = changes => sendOffsets(text, changes);

// A change from outside; while a card, list name or date is being typed it waits, see sendOffsets.
export function updateBoard(next) {
  if (root.querySelector('textarea, .lane-edit') || document.querySelector('.datepick')) { pendingText = next; return; }
  setText(next);
  showBoard();
}

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const boardLanes = () => K.parse(text).filter(l => !l.archive);
const isComplete = (s, lane) => (s['complete-lists'] || []).includes(lane.title);
const searchKey = card => [card.text, ...card.subs.map(x => x.text)].join(' ').toLowerCase();
const ddmmyy = () => { const [y, m, d] = today().split('-'); return `${d}/${m}/${y.slice(2)}`; };
let query = '', showArchive = false, renameNext = null, menuEl = null;

// Lucide-style line icons (ISC licence), 24x24 paths.
const ICONS = {
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6M9 15h6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
  before: '<path d="M5 3h14"/><path d="m18 13-6-6-6 6"/><path d="M12 7v14"/>',
  after: '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  date: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>',
  sort: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  listBefore: '<path d="M3 5v14"/><path d="M21 12H7"/><path d="m13 18-6-6 6-6"/>',
  listAfter: '<path d="M17 12H3"/><path d="m11 18 6-6-6-6"/><path d="M21 5v14"/>',
  plus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/>',
  text: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  dots: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
const iconBtn = (name, title, cls = 'icon-btn') => { const b = el('button', cls); b.innerHTML = icon(name); b.title = title; return b; };

function closeMenu() { menuEl?.remove(); menuEl = null; }
// items: [icon, label, fn] or [icon, label, [sub items]] or '-'; a label starting with '!' asks for a second click.
function menu(x, y, items, parent = null) {
  if (!parent) closeMenu();
  const box = el('div', 'menu');
  for (const it of items) {
    if (it === '-') { box.append(el('hr')); continue; }
    const [ic, label, act] = it, b = el('button');
    b.innerHTML = icon(ic) + `<span>${esc(label.replace(/^!/, ''))}</span>` + (Array.isArray(act) ? icon('right') : '');
    if (Array.isArray(act)) {
      b.classList.add('has-sub');
      const openSub = () => {
        box.querySelector('.menu')?.remove();
        const r = b.getBoundingClientRect();
        menu(r.right - 4, r.top - 4, act, box);
      };
      b.onmouseenter = openSub;
      b.onclick = e => { e.stopPropagation(); openSub(); };
    } else {
      b.onmouseenter = () => box.querySelector('.menu')?.remove();
      b.onclick = e => {
        e.stopPropagation();
        if (label.startsWith('!') && !b.dataset.sure) { b.dataset.sure = 1; b.querySelector('span').textContent = 'Click again to confirm'; b.classList.add('danger'); return; }
        closeMenu();
        act();
      };
    }
    box.append(b);
  }
  if (parent) parent.append(box); else { menuEl = box; document.body.append(box); }
  const r = box.getBoundingClientRect();
  box.style.left = (x + r.width > innerWidth - 8 && parent ? x - r.width - parent.getBoundingClientRect().width + 8 : Math.min(x, innerWidth - r.width - 8)) + 'px';
  box.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
addEventListener('mousedown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

// A textarea in place of `anchor`; Enter commits, Shift+Enter is a new line, Esc or an empty value cancels.
function inputIn(anchor, value, placeholder, commit, rows = 2) {
  const box = el('textarea');
  box.rows = rows;
  box.value = value;
  box.placeholder = placeholder;
  let done = false;
  const finish = ok => {
    if (done) return;
    done = true;
    if (ok && box.value.trim() && box.value !== value) commit(box.value);
    else { box.replaceWith(anchor); if (pendingText != null) showBoard(); }
  };
  box.onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Escape') finish(false);
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
  };
  box.onblur = () => finish(true);
  anchor.replaceWith(box);
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
}

function pickDate(card) {
  const d = el('input', 'datepick');
  d.type = 'date';
  d.value = K.dateOf(card.text) || today();
  document.body.append(d);
  d.onchange = () => { edit(K.setDate(text, card, d.value)); d.remove(); };
  d.onblur = () => setTimeout(() => { if (!d.isConnected) return; d.remove(); if (pendingText != null) showBoard(); }, 300);
  try { d.showPicker(); } catch { d.focus(); }
}

function noteFromCard(card) {
  const link = K.linkCard(text, card);
  if (!link) return;
  edit(link.changes);
  vscode.postMessage({ type: 'newNote', name: link.name });
}

// A new card at `pos` (an offset at a line start) inside `lane`, typed in place of the lane's add button.
function adder(lane, pos) {
  const btn = root.querySelector(`.lane[data-start="${lane.start}"] .add`);
  if (btn) inputIn(btn, '', 'Card title, Enter to add, Esc to cancel', v => edit(K.insertCard(pos, v)));
}

function editCard(node, card) {
  inputIn(node, K.cardSource(text, card), '', v => edit(K.editCard(text, card, v)), Math.max(2, card.subs.length + 2));
}

function cardMenu(e, lane, card, s) {
  e.preventDefault();
  const moveTo = boardLanes().filter(l => l.start !== lane.start).map(l => ['board', l.title, () => edit(K.moveCard(text, card, l, null, isComplete(s, l)))]);
  const del = ['trash', '!Delete card', () => edit(K.deleteCard(text, card))];
  const items = lane.archive ? [['board', 'Move to list', moveTo], '-', del] : [
    ['edit', 'Edit card', () => editCard(e.target.closest('.card') || e.target.closest('tr').cells[1], card)],
    ['note', 'New note from card', () => noteFromCard(card)],
    ['link', 'Copy link to card', () => {
      const { id, changes } = K.blockId(text, card);
      if (changes.length) edit(changes);
      vscode.postMessage({ type: 'copy', text: `[[${note.title}#^${id}]]` });
    }],
    '-',
    ['copy', 'Duplicate card', () => edit(K.duplicateCard(text, card))],
    ['before', 'Insert card before', () => adder(lane, card.start)],
    ['after', 'Insert card after', () => adder(lane, card.end)],
    ['up', 'Move to top', () => edit(K.moveCard(text, card, lane, lane.cards[0]))],
    ['down', 'Move to bottom', () => edit(K.moveCard(text, card, lane, null))],
    ['archive', 'Archive card', () => edit(K.archiveCards(text, [card]))],
    del,
    '-',
    ['date', 'Add date', () => pickDate(card)],
    '-',
    ['board', 'Move to list', moveTo],
  ];
  menu(e.clientX, e.clientY, items);
}

// `li` is the lane's index among the board lanes, which Obsidian's `list-collapse` flags follow.
function laneMenu(e, lane, li) {
  const sort = by => () => edit(K.sortLane(text, lane, by));
  menu(e.clientX, e.clientY, [
    ['edit', 'Edit list', () => { renameNext = li; showBoard(); }],
    ['archive', 'Archive cards', () => edit(K.archiveCards(text, lane.cards.filter(c => c.checked)))],
    '-',
    ['listBefore', 'Insert list before', () => { renameNext = li; edit([...K.addLane(text, 'New list', lane), ...K.foldSplice(text, li, 0, 1)]); }],
    ['listAfter', 'Insert list after', () => { renameNext = li + 1; edit([...K.addLane(text, 'New list', boardLanes()[li + 1] || null), ...K.foldSplice(text, li + 1, 0, 1)]); }],
    '-',
    ['archive', 'Archive list', () => edit([...K.archiveLane(text, lane), ...K.foldSplice(text, li, 1)])],
    ['trash', '!Delete list', () => edit([...K.deleteLane(text, lane), ...K.foldSplice(text, li, 1)])],
    '-',
    ['sort', 'Sort by', [['text', 'Card text', sort('text')], ['date', 'Date', sort('date')]]],
  ]);
}

// Edit list: name plus Obsidian's "mark cards in this list as complete" switch.
function editLane(title, lane) {
  const done = K.settings(text)['complete-lists'] || [];
  const form = el('div', 'lane-edit');
  const name = el('input');
  name.value = lane.title;
  const label = el('label');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = done.includes(lane.title);
  label.append(box, ' Mark cards in this list as complete');
  let closed = false;
  const save = () => {
    if (closed) return;
    closed = true;
    const v = name.value.trim() || lane.title, list = done.filter(t => t !== lane.title);
    if (box.checked) list.push(v);
    const changes = [...(v !== lane.title ? K.renameLane(text, lane, v) : []), ...(JSON.stringify(list) !== JSON.stringify(done) ? K.setSetting(text, 'complete-lists', list) : [])];
    if (changes.length) edit(changes); else showBoard();
  };
  name.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') save(); if (e.key === 'Escape') { closed = true; showBoard(); } };
  form.onfocusout = () => setTimeout(() => { if (!form.contains(document.activeElement)) save(); });
  form.append(name, label);
  title.replaceWith(form);
  name.focus();
  name.select();
}

function applyFilter() {
  const q = query.toLowerCase();
  for (const c of root.querySelectorAll('[data-search]')) c.hidden = !!q && !c.dataset.search.includes(q);
}

function cardEl(card, lane, li, s, drag) {
  const node = el('article', 'card' + (card.checked ? ' done' : ''));
  node.dataset.search = searchKey(card);
  node.draggable = true;
  node.ondragstart = e => { e.stopPropagation(); drag.v = { card }; node.classList.add('dragging'); };
  node.ondragend = () => node.classList.remove('dragging');
  node.ondragover = e => { if (drag.v?.card) { e.preventDefault(); node.classList.add('over'); } };
  node.ondragleave = () => node.classList.remove('over');
  node.ondrop = e => { if (!drag.v?.card) return; e.preventDefault(); e.stopPropagation(); drag.drop(lane, li, card); };
  node.oncontextmenu = e => cardMenu(e, lane, card, s);
  node.ondblclick = e => { if (!lane.archive && !e.target.closest('a,input')) editCard(node, card); };
  const row = el('div', 'row');
  if (card.checked !== null && s['show-checkboxes'] !== false) {
    const box = el('input');
    box.type = 'checkbox';
    box.checked = card.checked;
    box.onclick = () => edit(K.toggle(text, card.marker));
    row.append(box);
  }
  const body = el('div', 'body');
  body.innerHTML = inline(card.text.replace(/\s\^[\w-]+$/, ''));
  const more = iconBtn('dots', 'Card menu (or right-click)', 'more');
  more.onclick = e => cardMenu(e, lane, card, s);
  row.append(body, more);
  node.append(row);
  if (card.subs.length) {
    const ul = el('ul');
    for (const sub of card.subs) {
      const item = el('li', sub.checked ? 'done' : '');
      if (sub.checked !== null) {
        const b = el('input');
        b.type = 'checkbox';
        b.checked = sub.checked;
        b.onclick = () => edit(K.toggle(text, sub.marker));
        item.append(b);
      }
      const span = el('span');
      span.innerHTML = inline(sub.text);
      item.append(span);
      ul.append(item);
    }
    const n = card.subs.filter(x => x.checked !== null), d = n.filter(x => x.checked).length;
    if (n.length) {
      const bar = el('div', 'progress');
      bar.style.setProperty('--p', d / n.length);
      bar.title = `${d} of ${n.length} done`;
      node.append(bar);
    }
    node.append(ul);
  }
  return node;
}

function laneEl(lane, li, s, collapsed, drag) {
  const col = el('section', 'lane');
  col.dataset.start = lane.start;
  if (lane.archive) col.classList.add('archive');
  if (collapsed) col.classList.add('collapsed');
  if (lane.title === ddmmyy()) col.classList.add('today');
  if (isComplete(s, lane)) col.classList.add('complete');
  const head = el('header');
  const grip = el('span', 'grip');
  grip.innerHTML = icon('grip');
  const fold = iconBtn('chevron', collapsed ? 'Expand list' : 'Collapse list', 'fold');
  fold.onclick = () => {
    const n = boardLanes().length, cur = s['list-collapse'] || [];
    edit(K.setSetting(text, 'list-collapse', Array.from({ length: n }, (_, i) => i === li ? !collapsed : !!cur[i])));
  };
  const title = el('h3', null, lane.archive ? 'Archive' : lane.title);
  const count = el('small', null, String(lane.cards.length));
  count.hidden = !!s['hide-card-count'];
  const more = iconBtn('dots', 'List menu', 'more');
  more.onclick = e => laneMenu(e, lane, li);
  grip.hidden = fold.hidden = more.hidden = lane.archive;
  head.append(grip, fold, title, count, more);
  if (!lane.archive) {
    head.draggable = true;
    head.ondragstart = e => { drag.v = { lane, li }; e.dataTransfer.effectAllowed = 'move'; };
    head.oncontextmenu = e => { e.preventDefault(); laneMenu(e, lane, li); };
    title.ondblclick = () => editLane(title, lane);
  }
  col.append(head);
  col.ondragover = e => { if (drag.v) { e.preventDefault(); col.classList.add('over'); } };
  col.ondragleave = e => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); };
  col.ondrop = e => { e.preventDefault(); col.classList.remove('over'); drag.drop(lane, li, null); };
  if (renameNext === li) {
    renameNext = null;
    setTimeout(() => editLane(title, lane));
  }
  if (collapsed) return col;
  const list = el('div', 'cards');
  for (const card of lane.cards) list.append(cardEl(card, lane, li, s, drag));
  col.append(list);
  if (!lane.archive) {
    const add = el('button', 'add', '+ Add a card');
    add.onclick = () => inputIn(add, '', 'Card title, Enter to add, Esc to cancel', v => edit(K.addCard(text, lane, v, s['new-card-insertion-method'] === 'prepend')));
    col.append(add);
  }
  return col;
}

function tableView(lanes, s) {
  const wrap = el('div', 'table-view');
  const table = el('table');
  table.innerHTML = '<thead><tr><th></th><th>Card</th><th>List</th><th>Date</th><th>Tags</th></tr></thead>';
  const body = table.createTBody();
  for (const lane of lanes) for (const card of lane.cards) {
    const tr = body.insertRow();
    tr.dataset.search = searchKey(card);
    tr.oncontextmenu = e => cardMenu(e, lane, card, s);
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !!card.checked;
    box.hidden = card.checked === null;
    box.onclick = () => edit(K.toggle(text, card.marker));
    tr.insertCell().append(box);
    const c = tr.insertCell();
    c.innerHTML = inline(card.text.replace(K.TAG, '$1').replace(/\s*@\{[^}]*\}/g, '').trim());
    if (card.checked) c.className = 'done';
    tr.insertCell().textContent = lane.title;
    tr.insertCell().innerHTML = inline(K.dateOf(card.text) ? `@{${K.dateOf(card.text)}}` : '');
    tr.insertCell().innerHTML = inline(K.tagsOf(card.text).join(' '));
  }
  wrap.append(table);
  return wrap;
}

// Moving a card (onto a lane or before a card) or a lane (before or after the target lane).
function dropper(lanes, s) {
  const drag = { v: null };
  drag.drop = (lane, li, before) => {
    const d = drag.v;
    drag.v = null;
    if (!d) return;
    if (d.lane) {
      if (lane.archive || li === d.li) return;
      const order = lanes.map((_, i) => i).filter(i => i !== d.li);
      order.splice(order.indexOf(li) + (d.li > li ? 0 : 1), 0, d.li);
      const fold = s['list-collapse'];
      edit([...K.moveLane(text, d.lane, d.li > li ? lane : lanes[li + 1] || null), ...(fold ? K.setSetting(text, 'list-collapse', order.map(i => !!fold[i])) : [])]);
    } else if (lane.archive) {
      edit(K.archiveCards(text, [d.card]));
    } else {
      edit(K.moveCard(text, d.card, lane, before, isComplete(s, lane)));
    }
  };
  return drag;
}

export function showBoard() {
  if (pendingText != null) { setText(pendingText); pendingText = null; }
  closeMenu();
  const scroll = root.querySelector('.board, .table-view');
  const pos = scroll ? [scroll.scrollLeft, scroll.scrollTop] : [0, 0];
  root.innerHTML = '';
  const s = K.settings(text), all = K.parse(text), lanes = all.filter(l => !l.archive);
  const kind = ['list', 'table'].includes(s['kanban-plugin']) ? s['kanban-plugin'] : 'board';
  root.className = 'board-root view-' + kind;
  if (kind === 'table') {
    root.append(tableView(lanes, s));
  } else {
    const board = el('div', 'board');
    if (s['lane-width']) board.style.setProperty('--lane', s['lane-width'] + 'px');
    const collapsed = s['list-collapse'] || [], drag = dropper(lanes, s);
    lanes.forEach((lane, li) => board.append(laneEl(lane, li, s, !!collapsed[li], drag)));
    const arch = all.find(l => l.archive);
    if (showArchive && arch) board.append(laneEl(arch, -1, s, false, drag));
    const add = el('button', 'add-lane', '+ Add a list');
    add.onclick = () => inputIn(add, '', 'List name, Enter to add', v => edit(K.addLane(text, v.replace(/\s*\n\s*/g, ' '))), 1);
    board.append(add);
    board.onclick = e => { const a = e.target.closest('a[data-target],a[data-href]'); if (a) follow(a); };
    root.append(board);
  }
  for (const c of s['tag-colors'] || []) for (const t of root.querySelectorAll('.tag')) {
    if (t.textContent === c.tagKey) Object.assign(t.style, { color: c.color || '', background: c.backgroundColor || '' });
  }
  const sc = root.firstChild;
  [sc.scrollLeft, sc.scrollTop] = pos;
  applyFilter();
}

// Toolbar like Obsidian's: add list, archive completed cards, switch to text, search, view.
export function toolbar(toggleMode) {
  const box = document.getElementById('bar');
  const q = el('input', 'search');
  q.type = 'search';
  q.placeholder = 'Search cards';
  q.hidden = true;
  q.oninput = () => { query = q.value; applyFilter(); };
  q.onkeydown = e => { if (e.key === 'Escape') { q.value = query = ''; q.hidden = true; applyFilter(); } };
  const add = iconBtn('plus', 'Add a list');
  add.onclick = () => { const b = root.querySelector('.add-lane'); if (b) { b.scrollIntoView({ inline: 'end' }); b.click(); } };
  const arch = iconBtn('archive', 'Archive completed cards');
  arch.onclick = () => edit(K.archiveCards(text, boardLanes().flatMap(l => l.cards.filter(c => c.checked))));
  const swap = iconBtn('text', 'Open as markdown');
  swap.onclick = toggleMode;
  const find = iconBtn('search', 'Search cards');
  find.onclick = () => { q.hidden = !q.hidden; if (!q.hidden) q.focus(); else { q.value = query = ''; applyFilter(); } };
  const eye = iconBtn('eye', 'View');
  eye.onclick = () => {
    const r = eye.getBoundingClientRect(), set = k => () => edit(K.setSetting(text, 'kanban-plugin', k));
    menu(r.left - 150, r.bottom + 4, [
      ['board', 'View as board', set('board')],
      ['text', 'View as list', set('list')],
      ['sort', 'View as table', set('table')],
      '-',
      ['archive', showArchive ? 'Hide archive' : 'Show archive', () => { showArchive = !showArchive; showBoard(); }],
    ]);
  };
  box.append(q, add, arch, swap, find, eye);
  return {
    show(kanban, board) {
      box.hidden = !kanban;
      add.hidden = arch.hidden = find.hidden = eye.hidden = !board;
      if (!board) q.hidden = true;
      swap.innerHTML = icon(board ? 'text' : 'board');
      swap.title = board ? 'Open as markdown' : 'Open as board';
    },
  };
}
