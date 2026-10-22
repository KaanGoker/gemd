// Obsidian Kanban files: front matter with `kanban-plugin:`, `## Lane` headings, `- [ ] card` lines,
// an optional `***` + `## Archive` section, and a `%% kanban:settings` JSON block at the end.
// Every edit is a list of {from, to, insert} on the raw text, so nothing outside the touched lines changes.
// Text is `\n` only: the webview normalizes it, and the host writes the file's own line ends back.

const CARD = /^- (?:\[([ xX])\] ?)?(.*)$/;
const SUB = /^\s+- \[([ xX])\] ?(.*)$/;

// Card metadata, one definition for the board, the table view and the live preview.
const TAG_BODY = String.raw`#[\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*`;
export const TAG = new RegExp(String.raw`(^|\s)(${TAG_BODY})`, 'gu');
const META = String.raw`@@?\{[^}]*\}|${TAG_BODY}`;
export const tagsOf = s => [...s.matchAll(TAG)].map(m => m[2]);
export const dateOf = s => (/@\{(\d{4}-\d{2}-\d{2})\}/.exec(s) || [])[1] || '';

export function isKanban(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  return !!m && /^kanban-plugin:/m.test(m[1]);
}

const settingsAt = text => { const i = text.indexOf('\n%% kanban:settings'); return i === -1 ? text.length : i + 1; };

// Lanes in order; lanes after the `***` line have archive: true.
// lane: {title, start (heading line), headEnd (after heading), end (next heading, ***, settings or EOF), insertAt, cards}
// card: {start, lineEnd (end of its first line), end (after its subs), checked, text, marker, subs}
export function parse(text) {
  const lanes = [];
  let lane = null, card = null, pos = 0, archive = false;
  const lines = text.split('\n');
  const stop = settingsAt(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = pos;
    pos += line.length + (i < lines.length - 1 ? 1 : 0);
    if (start >= stop) break;
    if (line === '***') {
      if (lane) lane.end = start;
      lane = card = null;
      archive = true;
      continue;
    }
    if (line.startsWith('## ')) {
      if (lane) lane.end = start;
      lane = { title: line.slice(3).trim(), start, headEnd: pos, end: pos, cards: [], insertAt: pos, archive };
      // An empty lane keeps one blank line under its heading.
      if (lines[i + 1] === '') lane.insertAt = pos + 1;
      lanes.push(lane);
      card = null;
      continue;
    }
    if (!lane) continue;
    lane.end = pos;
    let m;
    if ((m = CARD.exec(line))) {
      // A hand-written `- text` line is a card too, just without a checkbox (checked null).
      card = { start, lineEnd: start + line.length, end: pos, checked: m[1] === undefined ? null : m[1] !== ' ', text: m[2], marker: m[1] === undefined ? -1 : start + 3, subs: [] };
      lane.cards.push(card);
      lane.insertAt = pos;
    } else if (card && line.trim() !== '' && /^\s/.test(line)) {
      if ((m = SUB.exec(line))) card.subs.push({ checked: m[1] !== ' ', text: m[2], marker: start + line.indexOf('[') + 1 });
      else card.subs.push({ checked: null, text: line.trim(), marker: -1 });
      card.end = pos;
      lane.insertAt = pos;
    } else {
      card = null;
    }
  }
  if (lane && lane.end > stop) lane.end = stop;
  return lanes;
}

// The JSON in the `%% kanban:settings` block at the end, or {}.
export function settings(text) {
  const m = /%% kanban:settings\s*```\s*([\s\S]*?)```/.exec(text);
  try { return m ? JSON.parse(m[1]) : {}; } catch { return {}; }
}

// Rewrite one key in the settings JSON (Obsidian writes it as one compact line); add the block when missing.
export function setSetting(text, key, value) {
  const m = /(%% kanban:settings\s*```\s*)([\s\S]*?)(\s*```)/.exec(text);
  // A block that does not parse is left alone rather than replaced by one key.
  if (m) { try { JSON.parse(m[2]); } catch { return []; } }
  const s = settings(text);
  if (value === undefined) delete s[key]; else s[key] = value;
  const json = JSON.stringify(s);
  if (m) return [{ from: m.index + m[1].length, to: m.index + m[1].length + m[2].length, insert: json }];
  const pre = text.endsWith('\n') ? '\n' : '\n\n';
  return [{ from: text.length, to: text.length, insert: `${pre}%% kanban:settings\n\`\`\`\n${json}\n\`\`\`\n%%` }];
}

function block(text, card) {
  const b = text.slice(card.start, card.end);
  return b.endsWith('\n') ? b : b + '\n';
}

// Move a card before `beforeCard`, or to the end of `lane` when beforeCard is null.
// `complete`: the target lane is in the board's `complete-lists`, so the card gets ticked on the way in.
export function moveCard(text, card, lane, beforeCard, complete = false) {
  const at = beforeCard ? beforeCard.start : lane.insertAt;
  if (at >= card.start && at <= card.end) return [];
  let b = block(text, card);
  if (complete) b = b.replace(/^- \[ \]/, '- [x]');
  const del = { from: card.start, to: card.end, insert: '' };
  const ins = { from: at, to: at, insert: b };
  return at < card.start ? [ins, del] : [del, ins];
}

// A new card at `at`, an offset at a line start.
export function insertCard(at, title) {
  return [{ from: at, to: at, insert: `- [ ] ${title.replace(/\s*\n\s*/g, ' ').trim()}\n` }];
}

// `top`: the board's `new-card-insertion-method` is prepend.
export function addCard(text, lane, title, top = false) {
  return insertCard(top && lane.cards.length ? lane.cards[0].start : lane.insertAt, title);
}

export function toggle(text, marker) {
  return [{ from: marker, to: marker + 1, insert: text[marker] === ' ' ? 'x' : ' ' }];
}

const cardPrefix = (text, card) => text.slice(card.start, card.lineEnd).match(/^- (?:\[[ xX]\] ?)?/)[0];

// The editable part of a card: its block without the `- [ ] ` prefix and the final line break.
export function cardSource(text, card) {
  return text.slice(card.start, card.end).replace(/\n$/, '').slice(cardPrefix(text, card).length);
}

export function editCard(text, card, source) {
  return [{ from: card.start, to: card.end, insert: cardPrefix(text, card) + source.replace(/\s+$/, '') + '\n' }];
}

export function deleteCard(text, card) { return [{ from: card.start, to: card.end, insert: '' }]; }

export function duplicateCard(text, card) { return [{ from: card.end, to: card.end, insert: block(text, card) }]; }

// Set the card's `@{date}`, or add one at the end of its first line.
export function setDate(text, card, date) {
  const line = text.slice(card.start, card.lineEnd), tag = `@{${date}}`;
  return [{ from: card.start, to: card.lineEnd, insert: /@\{[^}]*\}/.test(line) ? line.replace(/@\{[^}]*\}/, tag) : line + ' ' + tag }];
}

// "New note from card": the card text becomes `[[name]]`, its trailing dates and tags stay.
// Returns null when nothing is left to name the note.
export function linkCard(text, card) {
  const name = card.text.replace(new RegExp(`(^|\\s)(${META})`, 'gu'), '$1').replace(/\[\[|\]\]/g, '')
    .replace(/[\\/:*?"<>|^#[\]]/g, '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const s = card.start + text.slice(card.start).indexOf(card.text);
  const rest = card.text.match(new RegExp(`(\\s+(${META}))+$`, 'u'))?.[0] || '';
  return { name, changes: [{ from: s, to: s + card.text.length, insert: `[[${name}]]${rest}` }] };
}

const archiveSection = body => `\n***\n\n## Archive\n\n${body}\n`;

// Cards go to the end of the `## Archive` lane after `***`; both are created when missing.
export function archiveCards(text, cards) {
  if (!cards.length) return [];
  const arch = parse(text).find(l => l.archive);
  const body = cards.map(c => block(text, c)).join('');
  const dels = cards.map(c => ({ from: c.start, to: c.end, insert: '' }));
  const at = arch ? arch.insertAt : lanesEnd(text);
  return [...dels, { from: at, to: at, insert: arch ? body : archiveSection(body) }];
}

// Archive a whole lane: its cards go to the archive, the lane goes away.
export function archiveLane(text, lane) {
  const body = lane.cards.map(c => block(text, c)).join('');
  const del = { from: lane.start, to: lane.end, insert: '' };
  const arch = parse(text).find(l => l.archive);
  if (arch) return body ? [del, { from: arch.insertAt, to: arch.insertAt, insert: body }] : [del];
  const at = lanesEnd(text);
  // The last lane: replace it with the new archive section in one edit.
  return at === lane.end ? [{ from: lane.start, to: lane.end, insert: archiveSection(body).slice(1) }] : [del, { from: at, to: at, insert: archiveSection(body) }];
}

// Where a new lane goes when appended: after the last board lane, before `***` and the settings.
function lanesEnd(text) {
  const lanes = parse(text).filter(l => !l.archive);
  return lanes.length ? lanes.at(-1).end : settingsAt(text);
}

export function addLane(text, title, before = null) {
  const at = before ? before.start : lanesEnd(text);
  const lead = at > 0 && text[at - 1] !== '\n' ? '\n' : '';
  return [{ from: at, to: at, insert: `${lead}## ${title.trim()}\n\n\n\n` }];
}

export function renameLane(text, lane, title) {
  const end = lane.headEnd - (text[lane.headEnd - 1] === '\n' ? 1 : 0);
  return [{ from: lane.start, to: end, insert: '## ' + title.trim() }];
}

export function deleteLane(text, lane) { return [{ from: lane.start, to: lane.end, insert: '' }]; }

export function moveLane(text, lane, before) {
  const at = before ? before.start : lanesEnd(text);
  if (at >= lane.start && at <= lane.end) return [];
  let b = text.slice(lane.start, lane.end);
  if (!b.endsWith('\n')) b += '\n';
  const del = { from: lane.start, to: lane.end, insert: '' };
  const ins = { from: at, to: at, insert: b };
  return at < lane.start ? [ins, del] : [del, ins];
}

// Sort the cards of a lane by 'text' or 'date' (cards without a date last); blank lines between cards are dropped.
export function sortLane(text, lane, by) {
  if (lane.cards.length < 2) return [];
  const key = c => by === 'date' ? (dateOf(c.text) || '9999') + c.text.toLowerCase() : c.text.toLowerCase();
  const sorted = [...lane.cards].sort((a, b) => key(a).localeCompare(key(b)));
  const from = lane.cards[0].start, to = lane.cards.at(-1).end;
  // Loose text between cards would be dropped by the rewrite, so such a lane is not sorted.
  let rest = text.slice(from, to);
  for (const c of lane.cards) rest = rest.replace(text.slice(c.start, c.end), '');
  if (rest.trim()) return [];
  return [{ from, to, insert: sorted.map(c => block(text, c)).join('') }];
}

export function apply(text, changes) {
  for (const c of [...changes].sort((a, b) => b.from - a.from)) text = text.slice(0, c.from) + c.insert + text.slice(c.to);
  return text;
}

// The `^id` block reference Obsidian links to, added to the card's first line when missing.
export function blockId(text, card) {
  const m = /\s\^([\w-]+)$/.exec(card.text);
  if (m) return { id: m[1], changes: [] };
  const id = Math.random().toString(36).slice(2, 8);
  return { id, changes: [{ from: card.lineEnd, to: card.lineEnd, insert: ' ^' + id }] };
}

// Keep Obsidian's per-lane `list-collapse` flags in step when lanes are inserted or removed at `index`.
export function foldSplice(text, index, remove, insert = 0) {
  const fold = settings(text)['list-collapse'];
  if (!fold) return [];
  const next = [...fold];
  next.splice(index, remove, ...Array(insert).fill(false));
  return setSetting(text, 'list-collapse', next);
}

// The one change that turns `base` into `next`: the differing middle between a common prefix and suffix.
export function diffRange(base, next) {
  let a = 0, b = 0;
  while (a < base.length && a < next.length && base[a] === next[a]) a++;
  while (b < base.length - a && b < next.length - a && base[base.length - 1 - b] === next[next.length - 1 - b]) b++;
  return { from: a, to: base.length - b, insert: next.slice(a, next.length - b) };
}

// Map board edits made on `base` onto `next` (the file after an outside change).
// Edits outside the changed region shift; an edit inside it returns null (conflict).
export function rebase(changes, base, next) {
  const d = diffRange(base, next), delta = next.length - base.length;
  const out = [];
  for (const c of changes) {
    if (c.to <= d.from) out.push(c);
    else if (c.from >= d.to) out.push({ ...c, from: c.from + delta, to: c.to + delta });
    else return null;
  }
  return out;
}
