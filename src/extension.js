const vscode = require('vscode');
const path = require('path');

const VIEW = 'gemd.markdown';
const EXCLUDE = '**/node_modules/**';

const activeUri = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri;
const noteName = p => path.posix.basename(p).replace(/\.md$/i, '').toLowerCase();

// Next to the current note first (relative Markdown links, Notion exports), then Obsidian style:
// `[[name]]` or `[[folder/name]]` anywhere in the workspace, extension optional for notes, shortest path wins.
// shortcut: case-sensitive match on Linux, Obsidian is case-insensitive; upgrade if links miss.
async function resolve(link, from) {
  const file = link.split('#')[0].trim();
  if (!file) return undefined;
  const target = path.posix.extname(file) ? file : file + '.md';
  if (from) {
    const near = vscode.Uri.joinPath(from, '..', target);
    try { await vscode.workspace.fs.stat(near); return near; } catch { /* not next to it, search below */ }
  }
  const hits = await vscode.workspace.findFiles('**/' + target.replace(/[[\]{}*?]/g, '?'), EXCLUDE, 50);
  return hits.filter(u => u.path.endsWith('/' + target)).sort((a, b) => a.path.length - b.path.length)[0];
}

const decode = s => { try { return decodeURIComponent(s); } catch { return s; } };

async function openLink(link, from) {
  let uri = await resolve(link, from);
  if (!uri) {
    const file = link.split('#')[0].trim();
    if (!file || (path.posix.extname(file) && !file.endsWith('.md'))) return vscode.window.showInformationMessage(`No file found for ${link}`);
    // Like Obsidian, a link to a missing note creates it; here next to the current note, and only after a yes.
    const name = file.endsWith('.md') ? file : file + '.md';
    if ((await vscode.window.showInformationMessage(`Create ${name}?`, { modal: true }, 'Create')) !== 'Create') return;
    uri = vscode.Uri.joinPath(from, '..', name);
    await vscode.workspace.fs.writeFile(uri, new Uint8Array());
  }
  await vscode.commands.executeCommand(uri.path.endsWith('.md') ? 'vscode.openWith' : 'vscode.open', uri, ...(uri.path.endsWith('.md') ? [VIEW] : []));
}

const fontSize = () => vscode.workspace.getConfiguration('gemd').get('fontSize', 16);
const BOARD = '---\n\nkanban-plugin: board\n\n---\n\n## To Do\n\n\n\n%% kanban:settings\n```\n{"kanban-plugin":"board"}\n```\n%%\n';

// Like Obsidian: `Untitled.md`, `Untitled 1.md`, ... in `dir`; an existing note of that exact name just opens.
async function createNote(dir, name, body = '', number = false) {
  const exists = async u => { try { await vscode.workspace.fs.stat(u); return true; } catch { return false; } };
  let uri = vscode.Uri.joinPath(dir, name + '.md');
  for (let i = 1; number && await exists(uri); i++) uri = vscode.Uri.joinPath(dir, `${name} ${i}.md`);
  if (!await exists(uri)) await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(body));
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW);
}

async function newNote(board) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return;
  const name = await vscode.window.showInputBox({ prompt: board ? 'Board name' : 'Note name', value: 'Untitled', valueSelection: [0, 8] });
  if (!name?.trim()) return;
  await createNote(root, name.trim().replace(/\.md$/i, ''), board ? BOARD : '', true);
}

// The empty-area page Obsidian shows when every tab is closed.
let home = null;
function showHome(ctx) {
  if (home) return home.reveal();
  home = vscode.window.createWebviewPanel('gemd.home', 'New tab', vscode.ViewColumn.Active, { enableScripts: true });
  home.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'tab.svg');
  const btn = (cmd, label, key) => `<button data-cmd="${cmd}"><span>${label}</span>${key ? `<kbd>${key}</kbd>` : ''}</button>`;
  home.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>body{height:100vh;margin:0;display:flex;align-items:center;justify-content:center;font:15px -apple-system,"Segoe UI",sans-serif;color:var(--vscode-foreground)}
div{display:flex;flex-direction:column;gap:10px;min-width:220px}
button{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:10px 16px;border-radius:22px;border:1px solid var(--vscode-panel-border,#8884);background:none;color:inherit;font:inherit;cursor:pointer}
button:hover{background:var(--vscode-list-hoverBackground)}kbd{font:12px var(--vscode-editor-font-family,monospace);padding:2px 6px;border-radius:4px;background:var(--vscode-keybindingLabel-background,#8882)}</style></head>
<body><div>${btn('gemd.newNote', 'New note', 'Ctrl + N')}${btn('gemd.newBoard', 'New board')}${btn('workbench.action.quickOpen', 'Go to file', 'Ctrl + P')}</div>
<script>const api=acquireVsCodeApi();document.onclick=e=>{const b=e.target.closest('button');if(b)api.postMessage(b.dataset.cmd)}</script></body></html>`;
  home.webview.onDidReceiveMessage(cmd => {
    if (['gemd.newNote', 'gemd.newBoard', 'workbench.action.quickOpen'].includes(cmd)) vscode.commands.executeCommand(cmd);
  });
  home.onDidDispose(() => { home = null; });
}
// VS Code has Ctrl+P for files but nothing for folders, and Ctrl+P hides what .gitignore lists.
// The picker opens at once and fills while the walk runs; package and build folders are skipped.
const SKIP = new Set(['node_modules', 'venv', '__pycache__', 'site-packages', 'dist', 'build']);
async function goToFolder() {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return;
  const qp = vscode.window.createQuickPick();
  qp.placeholder = 'Go to folder';
  qp.matchOnDescription = true;
  qp.busy = true;
  const items = [];
  let timer = null;
  const flush = () => { timer = null; qp.items = [...items]; };
  qp.onDidAccept(() => {
    const pick = qp.selectedItems[0];
    qp.hide();
    if (pick) vscode.commands.executeCommand('revealInExplorer', vscode.Uri.joinPath(root, pick.description));
  });
  let closed = false;
  qp.onDidHide(() => { closed = true; qp.dispose(); });
  qp.show();
  const walk = async (uri, rel) => {
    if (closed) return;
    let entries = [];
    try { entries = await vscode.workspace.fs.readDirectory(uri); } catch { return; }
    const dirs = entries.filter(([n, t]) => t === vscode.FileType.Directory && !n.startsWith('.') && !SKIP.has(n));
    for (const [n] of dirs) items.push({ label: n, description: rel + n });
    if (!timer) timer = setTimeout(flush, 150);
    await Promise.all(dirs.map(([n]) => walk(vscode.Uri.joinPath(uri, n), rel + n + '/')));
  };
  await walk(root, '');
  if (!closed) { clearTimeout(timer); flush(); qp.busy = false; }
}

const tabCount = () => vscode.window.tabGroups.all.reduce((n, g) => n + g.tabs.length, 0);

function html(webview, ext) {
  const res = p => webview.asWebviewUri(vscode.Uri.joinPath(ext, p));
  const csp = `default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; font-src ${webview.cspSource}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${res('media/katex/katex.min.css')}"><link rel="stylesheet" href="${res('media/style.css')}"></head>
<body><div id="bar" hidden></div><div id="root"></div><script src="${res('dist/webview.js')}"></script></body></html>`;
}

function provider(ctx) {
  return {
    resolveCustomTextEditor(doc, panel) {
      panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [ctx.extensionUri, vscode.Uri.joinPath(doc.uri, '..'), ...(vscode.workspace.workspaceFolders || []).map(f => f.uri)],
      };
      panel.webview.html = html(panel.webview, ctx.extensionUri);
      const post = () => panel.webview.postMessage({ type: 'update', text: doc.getText() });
      let pending = 0, queue = Promise.resolve();
      // Changes from elsewhere (undo, git, Syncthing, another editor) go to the webview; our own edits do not echo back.
      const sub = vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document === doc && pending === 0 && e.contentChanges.length) post();
      });
      const cfg = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('gemd.fontSize')) panel.webview.postMessage({ type: 'font', fontSize: fontSize() });
      });
      panel.onDidDispose(() => { sub.dispose(); cfg.dispose(); });
      panel.webview.onDidReceiveMessage(m => {
        if (m.type === 'ready') {
          panel.webview.postMessage({ type: 'init', text: doc.getText(), fontSize: fontSize(), title: path.posix.basename(doc.uri.path, '.md') });
          vscode.workspace.findFiles('**/*.md', EXCLUDE).then(files => panel.webview.postMessage({
            type: 'names', names: [...new Set(files.map(u => path.posix.basename(u.path, '.md')))].sort(),
          }));
        }
        else if (m.type === 'edit') {
          queue = queue.then(async () => {
            const edit = new vscode.WorkspaceEdit();
            for (const c of m.changes) edit.replace(doc.uri, new vscode.Range(c.from.line, c.from.ch, c.to.line, c.to.ch), c.insert);
            pending++;
            let ok = false;
            try { ok = await vscode.workspace.applyEdit(edit); } finally { pending--; }
            if (!ok) post(); // resync the webview so it never drifts from the file
          });
        } else if (m.type === 'open') openLink(m.target, doc.uri);
        else if (m.type === 'warn') vscode.window.showWarningMessage(String(m.text));
        else if (m.type === 'copy') vscode.env.clipboard.writeText(String(m.text)).then(() => vscode.window.setStatusBarMessage('Link copied', 2000));
        else if (m.type === 'newNote') createNote(vscode.Uri.joinPath(doc.uri, '..'), String(m.name));
        else if (m.type === 'external') {
          const href = String(m.href);
          if (/^(https?|mailto):/i.test(href)) vscode.env.openExternal(vscode.Uri.parse(href));
          else if (!/^[a-z][\w+.-]*:/i.test(href)) openLink(decode(href), doc.uri);
        } else if (m.type === 'resolve') {
          const src = String(m.name);
          if (/^https?:/i.test(src)) panel.webview.postMessage({ type: 'resolved', name: src, src });
          else resolve(decode(src), doc.uri).then(uri => panel.webview.postMessage({ type: 'resolved', name: src, src: uri ? panel.webview.asWebviewUri(uri).toString() : '' }));
        }
      });
    },
  };
}

class Backlinks {
  constructor() {
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
    this.index = null;
  }
  refresh() { clearTimeout(this.timer); this.timer = setTimeout(() => this.changed.fire(), 200); }
  async read(uri) {
    try {
      const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      const links = [];
      text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/\[\[([^\]|#]+)/g)) links.push({ name: noteName(m[1].trim()), line: i, text: line.trim() });
      });
      this.index.set(uri.toString(), { uri, links });
    } catch {
      this.index.delete(uri.toString());
    }
  }
  async getChildren() {
    if (!this.index) {
      this.index = new Map();
      await Promise.all((await vscode.workspace.findFiles('**/*.md', EXCLUDE)).map(u => this.read(u)));
    }
    const cur = activeUri();
    if (!cur || !cur.path.endsWith('.md')) return [];
    const name = noteName(cur.path), out = [];
    for (const { uri, links } of this.index.values()) {
      if (uri.toString() === cur.toString()) continue;
      for (const l of links) if (l.name === name) out.push({ uri, l });
    }
    return out;
  }
  getTreeItem({ uri, l }) {
    const item = new vscode.TreeItem(path.posix.basename(uri.path, '.md'));
    item.description = l.text.slice(0, 100);
    item.tooltip = `${vscode.workspace.asRelativePath(uri)}:${l.line + 1}\n${l.text}`;
    item.command = { command: 'vscode.openWith', title: 'Open', arguments: [uri, VIEW] };
    return item;
  }
}

let isVault = false;

async function activate(ctx) {
  const backlinks = new Backlinks();
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
  const reindex = uri => { if (backlinks.index && !uri.path.includes('/node_modules/')) backlinks.read(uri).then(() => backlinks.refresh()); };
  ctx.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW, provider(ctx), { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerTreeDataProvider('gemd.backlinks', backlinks),
    vscode.window.tabGroups.onDidChangeTabs(() => backlinks.refresh()),
    watcher,
    watcher.onDidChange(reindex),
    watcher.onDidCreate(reindex),
    watcher.onDidDelete(uri => { backlinks.index?.delete(uri.toString()); backlinks.refresh(); }),
    vscode.commands.registerCommand('gemd.open', uri => vscode.commands.executeCommand('vscode.openWith', uri || activeUri(), VIEW)),
    vscode.commands.registerCommand('gemd.newNote', () => newNote(false)),
    vscode.commands.registerCommand('gemd.newBoard', () => newNote(true)),
    vscode.commands.registerCommand('gemd.home', () => showHome(ctx)),
    vscode.commands.registerCommand('gemd.goToFolder', goToFolder),
    // A note or board just opened from the page replaces it, like an Obsidian tab.
    vscode.window.tabGroups.onDidChangeTabs(e => {
      if (!isVault) return;
      if (home && e.opened.length && tabCount() > 1) home.dispose();
      else if (!home && e.closed.length && tabCount() === 0 && !e.closed.some(t => t.input?.viewType?.endsWith('gemd.home'))) showHome(ctx);
    }),
    vscode.commands.registerCommand('gemd.openText', uri => vscode.commands.executeCommand('vscode.openWith', uri || activeUri(), 'default')),
  );
  // Only an Obsidian vault gets Ctrl+N for notes and the New tab page.
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  try { if (root) { await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, '.obsidian')); isVault = true; } } catch { /* not a vault */ }
  vscode.commands.executeCommand('setContext', 'gemd.isVault', isVault);
  if (isVault && tabCount() === 0) showHome(ctx);
}

module.exports = { activate };
