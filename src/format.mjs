// Obsidian's formatting hotkeys as pure text edits: each returns { changes, from, to } for the new selection.

// Bold, italic, comment and the like: wrap the selection in `mark`, or unwrap it when the mark is already there.
export function wrap(text, from, to, mark) {
  const m = mark.length;
  if (text.slice(from - m, from) === mark && text.slice(to, to + m) === mark)
    return { changes: [{ from: from - m, to: from, insert: '' }, { from: to, to: to + m, insert: '' }], from: from - m, to: to - m };
  const sel = text.slice(from, to);
  if (sel.length >= 2 * m && sel.startsWith(mark) && sel.endsWith(mark))
    return { changes: [{ from, to: from + m, insert: '' }, { from: to - m, to, insert: '' }], from, to: to - 2 * m };
  return { changes: [{ from, to: from, insert: mark }, { from: to, to, insert: mark }], from: from + m, to: to + m };
}

// Insert a Markdown link: the selection becomes the text, or the address when it is a URL.
export function link(text, from, to) {
  const sel = text.slice(from, to);
  if (/^https?:\/\/\S+$/.test(sel)) return { changes: [{ from, to, insert: `[](${sel})` }], from: from + 1, to: from + 1 };
  const at = sel ? from + sel.length + 3 : from + 1;
  return { changes: [{ from, to, insert: `[${sel}]()` }], from: at, to: at };
}
