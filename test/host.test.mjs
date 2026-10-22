// The extension host side against a small fake of the vscode API: edit sync, echo suppression, link resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { posix } from 'node:path';

const listeners = [], posted = [], opened = [], external = [], written = [];
let doc, files = [], answer;

const uri = p => ({ path: p, toString: () => 'file://' + p });
class Range { constructor(a, b, c, d) { Object.assign(this, { a, b, c, d }); } }
class WorkspaceEdit { constructor() { this.edits = []; } replace(_u, r, t) { this.edits.push([r, t]); } }
const offset = (text, line, ch) => text.split('\n').slice(0, line).reduce((n, l) => n + l.length + 1, 0) + ch;

const vscode = {
  Range, WorkspaceEdit,
  Uri: { parse: s => s, joinPath: (b, ...p) => typeof b === 'string' ? [b, ...p].join('/') : uri(posix.join(b.path, ...p)) },
  EventEmitter: class { constructor() { this.event = () => {}; } fire() {} },
  TreeItem: class {},
  env: { openExternal: u => external.push(u) },
  window: { showInformationMessage: async (_m, _o, ...items) => answer ?? items[0], tabGroups: { activeTabGroup: {} } },
  commands: { executeCommand: (...a) => opened.push(a) },
  workspace: {
    workspaceFolders: [],
    onDidChangeTextDocument: f => { listeners.push(f); return { dispose() {} }; },
    findFiles: async () => files,
    fs: {
      stat: async u => { if (!files.some(f => f.path === u.path)) throw new Error('ENOENT'); return {}; },
      writeFile: async u => { written.push(u.path); },
    },
    // Like VS Code: all ranges refer to the text before the edit, inserted \n become the document EOL.
    applyEdit: async edit => {
      const old = doc.text;
      const parts = edit.edits.map(([r, t]) => [offset(old, r.a, r.b), offset(old, r.c, r.d), t.replace(/\n/g, doc.eol)]);
      for (const [a, b, t] of parts.sort((x, y) => y[0] - x[0])) doc.text = doc.text.slice(0, a) + t + doc.text.slice(b);
      listeners.forEach(f => f({ document: doc, contentChanges: [1] }));
      return true;
    },
  },
};

const resolveName = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'vscode' ? 'vscode' : resolveName.call(this, req, ...rest); };
Module._cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscode };
const require = createRequire(import.meta.url);
const ext = require('../src/extension.js');

const subs = [];
let provider;
vscode.window.registerCustomEditorProvider = (_id, p) => { provider = p; return {}; };
vscode.window.registerTreeDataProvider = () => ({});
vscode.window.tabGroups.onDidChangeTabs = () => ({});
vscode.workspace.createFileSystemWatcher = () => ({ onDidChange: () => ({}), onDidCreate: () => ({}), onDidDelete: () => ({}) });
const cmds = {};
vscode.commands.registerCommand = (id, f) => { cmds[id] = f; return {}; };
vscode.workspace.onDidChangeConfiguration = () => ({ dispose() {} });
vscode.workspace.getConfiguration = () => ({ get: (_k, d) => d });
vscode.window.tabGroups.all = [];
ext.activate({ subscriptions: { push: (...a) => subs.push(...a) }, extensionUri: 'ext' });

let receive;
function open(text, eol) {
  doc = { text, eol, getText() { return this.text; }, uri: uri('/v/a.md') };
  posted.length = 0;
  const panel = {
    webview: { options: {}, cspSource: 'csp', asWebviewUri: u => 'webview:' + (u.path || u), postMessage: m => posted.push(m), onDidReceiveMessage: f => { receive = f; } },
    onDidDispose: () => {},
  };
  provider.resolveCustomTextEditor(doc, panel);
}
const settle = () => new Promise(r => setTimeout(r, 10));

test('CRLF file: edits land at the right place, keep CRLF, and do not echo back', async () => {
  open('# A\r\n- [ ] one\r\n- [ ] two\r\n', '\r\n');
  receive({ type: 'ready' });
  assert.equal(posted[0].type, 'init');
  receive({ type: 'edit', changes: [{ from: { line: 2, ch: 3 }, to: { line: 2, ch: 4 }, insert: 'x' }] });
  receive({ type: 'edit', changes: [{ from: { line: 0, ch: 3 }, to: { line: 0, ch: 3 }, insert: '\nnew line' }] });
  await settle();
  assert.equal(doc.text, '# A\r\nnew line\r\n- [ ] one\r\n- [x] two\r\n');
  assert.equal(posted.filter(m => m.type === 'update').length, 0);
});

test('outside changes (undo, Syncthing) are sent to the webview', () => {
  open('a\n', '\n');
  doc.text = 'b\n';
  listeners.forEach(f => f({ document: doc, contentChanges: [1] }));
  assert.deepEqual(posted.at(-1), { type: 'update', text: 'b\n' });
});

test('links resolve to the exact name, shortest path first', async () => {
  open('', '\n');
  files = [uri('/v/09 Archive/x/Note.md'), uri('/v/My Note.md'), uri('/v/a/Note.md')];
  receive({ type: 'open', target: 'Note' });
  await settle();
  assert.equal(opened.at(-1)[1].path, '/v/a/Note.md');
});

test('only http, https and mailto links leave VS Code', async () => {
  open('', '\n');
  files = [];
  receive({ type: 'external', href: 'javascript:alert(1)' });
  receive({ type: 'external', href: 'command:workbench.action.terminal.new' });
  receive({ type: 'external', href: 'https://example.com' });
  await settle();
  assert.deepEqual(external, ['https://example.com']);
});

test('Notion-style image paths resolve next to the note, %20 decoded', async () => {
  open('', '\n');
  files = [uri('/v/a/2- Sign/image 1.png'), uri('/v/a/b/2- Sign/image 1.png')];
  doc.uri = uri('/v/a/note.md');
  receive({ type: 'resolve', name: '2-%20Sign/image%201.png' });
  await settle();
  assert.deepEqual(posted.at(-1), { type: 'resolved', name: '2-%20Sign/image%201.png', src: 'webview:/v/a/2- Sign/image 1.png' });
});

test('a link to a missing note creates it next to the note only after a yes', async () => {
  files = [];
  open('', '\n');
  answer = undefined;
  receive({ type: 'open', target: 'Brand New' });
  await settle();
  assert.deepEqual(written, ['/v/Brand New.md']);
  answer = 'Cancel';
  receive({ type: 'open', target: 'Other' });
  await settle();
  assert.deepEqual(written, ['/v/Brand New.md']);
  answer = undefined;
});

test('New note numbers Untitled like Obsidian and never overwrites', async () => {
  vscode.workspace.workspaceFolders = [{ uri: uri('/v') }];
  vscode.window.showInputBox = async () => 'Untitled';
  files = [uri('/v/Untitled.md'), uri('/v/Untitled 1.md')];
  written.length = 0; opened.length = 0;
  await cmds['gemd.newNote']();
  assert.deepEqual(written, ['/v/Untitled 2.md']);
  assert.equal(opened.at(-1)[1].path, '/v/Untitled 2.md');
});
