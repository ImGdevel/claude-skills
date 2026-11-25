#!/usr/bin/env node
// Build a one-page catalog of every Claude Code plugin and skill on this machine.
// Reads ~/.claude settings and plugin records; writes a self-contained HTML file.
// Usage: node catalog.mjs [--out <file.html>] [--json <file.json>] [--open | --app [--no-fill]] [--fill-ko] [--install-shortcut [name]]
// Korean one-line summaries live in ../data/ko-summaries.json; --fill-ko asks the claude CLI (haiku) for missing ones.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';

const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const OUT = argVal('--out') || path.join(CLAUDE, 'skill-catalog.html');
const JSON_OUT = argVal('--json');

const readJson = (p, fb = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const lsDirs = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory() || d.isSymbolicLink()).map(d => d.name); } catch { return []; } };
const lsFiles = (p, ext) => { try { return fs.readdirSync(p).filter(f => f.endsWith(ext)); } catch { return []; } };

// Rough token estimate: ~4 ASCII chars per token, ~1 token per non-ASCII char (Korean etc.).
function tokens(s) {
  if (!s) return 0;
  let ascii = 0, other = 0;
  for (const ch of s) (ch.charCodeAt(0) < 128 ? ascii++ : other++);
  return Math.round(ascii / 4 + other);
}

// Minimal frontmatter reader: top-level `key: value`, quoted values, and | / > blocks.
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: text };
  const lines = m[1].split(/\r?\n/);
  const fm = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let [, k, v] = kv;
    if (/^[|>][+-]?$/.test(v)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === '')) block.push(lines[++i].trim());
      v = block.join(v.startsWith('>') ? ' ' : ' ').trim();
    } else if (v === '') {
      continue; // nested map (metadata:) - not needed at top level
    } else {
      v = v.replace(/^(["'])([\s\S]*)\1$/, '$2');
    }
    fm[k] = v;
  }
  return { fm, body: text.slice(m[0].length) };
}

function readSkill(dir, plugin) {
  const file = path.join(dir, 'SKILL.md');
  const text = fs.readFileSync(file, 'utf8');
  const { fm, body } = frontmatter(text);
  const name = fm.name || path.basename(dir);
  const author = (text.match(/^\s+author:\s*(.+)$/m) || [])[1];
  return {
    name,
    id: plugin ? `${plugin}:${name}` : name,
    description: fm.description || '',
    slashOnly: String(fm['disable-model-invocation']).toLowerCase() === 'true',
    userInvocable: String(fm['user-invocable']).toLowerCase() !== 'false',
    license: fm.license || '',
    author: author ? author.replace(/^(["'])(.*)\1$/, '$2') : '',
    listTokens: tokens(`${name}: ${fm.description || ''}`),
    bodyTokens: tokens(body),
    files: countFiles(dir),
    path: dir,
  };
}

function countFiles(dir) {
  let n = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '__pycache__') continue; e.isDirectory() ? walk(path.join(d, e.name)) : n++; } };
  try { walk(dir); } catch {}
  return n;
}

function skillDirs(root, spec) {
  const specs = spec ? (Array.isArray(spec) ? spec : [spec]) : ['./skills'];
  const out = [];
  for (const s of specs) {
    const p = path.resolve(root, s);
    if (exists(path.join(p, 'SKILL.md'))) { out.push(p); continue; }
    for (const d of lsDirs(p)) if (exists(path.join(p, d, 'SKILL.md'))) out.push(path.join(p, d));
  }
  return [...new Set(out)];
}

function countMd(root, spec, fallback) {
  const specs = spec ? (Array.isArray(spec) ? spec : [spec]) : [fallback];
  let names = [];
  for (const s of specs) {
    const p = path.resolve(root, s);
    if (isDir(p)) names = names.concat(lsFiles(p, '.md').map(f => f.replace(/\.md$/, '')));
    else if (p.endsWith('.md') && exists(p)) names.push(path.basename(p, '.md'));
  }
  return names;
}

function hookEvents(root, manifest) {
  let h = manifest.hooks;
  if (typeof h === 'string') h = readJson(path.resolve(root, h), {})?.hooks;
  if (!h) h = readJson(path.join(root, 'hooks', 'hooks.json'), {})?.hooks;
  return h && typeof h === 'object' ? Object.keys(h) : [];
}

function mcpServers(root, manifest) {
  let m = manifest.mcpServers;
  if (typeof m === 'string') m = readJson(path.resolve(root, m), {})?.mcpServers;
  if (!m) m = readJson(path.join(root, '.mcp.json'), {})?.mcpServers;
  return m && typeof m === 'object' ? Object.keys(m) : [];
}

function sourceLabel(src) {
  if (!src) return { kind: 'unknown', label: '알 수 없음' };
  if (src.source === 'github') return { kind: 'github', label: src.repo, url: `https://github.com/${src.repo}` };
  if (src.source === 'directory') return { kind: 'directory', label: src.path };
  if (src.source === 'git' || src.source === 'url') return { kind: src.source, label: src.url, url: src.url };
  return { kind: src.source, label: JSON.stringify(src) };
}

// ---------- collect ----------
const settings = readJson(path.join(CLAUDE, 'settings.json'), {});
const known = readJson(path.join(CLAUDE, 'plugins', 'known_marketplaces.json'), {});
const installed = readJson(path.join(CLAUDE, 'plugins', 'installed_plugins.json'), { plugins: {} }).plugins || {};
const enabled = settings.enabledPlugins || {};
const extra = settings.extraKnownMarketplaces || {};

const plugins = [];
for (const [key, records] of Object.entries(installed)) {
  const rec = records[0];
  const [pname, market] = key.split('@');
  const km = known[market] || {};
  let root = rec.installPath;
  let loadsInPlace = false;
  if (km.source?.source === 'directory') {
    const mj = readJson(path.join(km.installLocation, '.claude-plugin', 'marketplace.json'), {});
    const entry = (mj.plugins || []).find(p => p.name === pname);
    if (entry && typeof entry.source === 'string') { root = path.resolve(km.installLocation, entry.source); loadsInPlace = true; }
  }
  const manifest = readJson(path.join(root, '.claude-plugin', 'plugin.json')) || readJson(path.join(root, 'plugin.json')) || {};
  const skills = [];
  for (const d of skillDirs(root, manifest.skills)) {
    try { skills.push(readSkill(d, pname)); } catch (e) { skills.push({ name: path.basename(d), id: `${pname}:${path.basename(d)}`, error: String(e.message) }); }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  plugins.push({
    key, name: pname, marketplace: market,
    enabled: enabled[key] === true,
    version: manifest.version || rec.version,
    description: manifest.description || '',
    author: manifest.author?.name || '',
    license: manifest.license || '',
    homepage: manifest.homepage || manifest.repository || '',
    source: sourceLabel(km.source),
    autoUpdate: extra[market]?.autoUpdate === true,
    loadsInPlace,
    root,
    lastUpdated: rec.lastUpdated || rec.installedAt,
    hasSourceNote: exists(path.join(root, 'SOURCE.md')),
    skills,
    agents: countMd(root, manifest.agents, './agents'),
    commands: countMd(root, manifest.commands, './commands'),
    hooks: hookEvents(root, manifest),
    mcp: mcpServers(root, manifest),
  });
}
plugins.sort((a, b) => (a.marketplace === b.marketplace ? a.name.localeCompare(b.name) : a.marketplace.localeCompare(b.marketplace)));

// Skills outside plugins: ~/.claude/skills (personal, links managed by other apps, claude.ai synced).
const loose = [];
const skillsRoot = path.join(CLAUDE, 'skills');
for (const name of lsDirs(skillsRoot)) {
  const p = path.join(skillsRoot, name);
  if (name === 'synced') {
    for (const bucket of lsDirs(p)) {
      const man = readJson(path.join(p, bucket, 'manifest.json'), { skills: [] });
      for (const s of man.skills || []) loose.push({ kind: 'synced', name: s.name, description: s.description || '', listTokens: tokens(`${s.name}: ${s.description || ''}`), note: s.source === 'anthropic-example' ? 'Anthropic 제공' : '내 claude.ai 스킬' });
    }
    continue;
  }
  let kind = 'personal', note = '';
  try { if (fs.lstatSync(p).isSymbolicLink()) { kind = 'link'; note = fs.readlinkSync(p); } } catch {}
  try { const s = readSkill(fs.realpathSync(p), null); loose.push({ ...s, kind, note }); } catch { loose.push({ kind, name, note, description: '' }); }
}

const data = {
  generatedAt: new Date().toISOString(),
  host: os.hostname(),
  plugins,
  loose,
  disabledMarketplaces: Object.keys(known).filter(m => !plugins.some(p => p.marketplace === m)),
};

// ---------- Korean summaries ----------
// data/ko-summaries.json: { "<id>": { "ko": "한글 요약", "src": "<hash of the description it was written from>" } }
// A summary whose src no longer matches the description is shown but marked stale, and refilled by --fill-ko.
const KO_FILE = path.join(HERE, '..', 'data', 'ko-summaries.json');
const hash = (s) => crypto.createHash('sha1').update(s || '').digest('hex').slice(0, 10);
const looseId = (s) => (s.kind === 'synced' ? `synced:${s.name}` : s.name);
const everySkill = () => [...plugins.flatMap(p => p.skills), ...loose.map(s => Object.assign(s, { id: looseId(s) }))];

function attachKo() {
  const ko = readJson(KO_FILE, {});
  let missing = 0;
  for (const s of everySkill()) {
    const e = ko[s.id];
    s.ko = e?.ko || '';
    s.koStale = !!e && e.src !== hash(s.description);
    if (!s.ko || s.koStale) missing++;
  }
  data.koMissing = missing;
  return ko;
}

// Find the Claude Code CLI: PATH first, then the copy bundled with the desktop app (newest version).
function findClaude() {
  const onPath = (process.env.PATH || '').split(path.delimiter).map(d => path.join(d, process.platform === 'win32' ? 'claude.exe' : 'claude')).find(exists);
  if (onPath) return onPath;
  const roots = [path.join(HOME, '.local', 'bin', 'claude.exe'), path.join(HOME, '.local', 'bin', 'claude')].filter(exists);
  if (roots.length) return roots[0];
  const base = path.join(process.env.LOCALAPPDATA || '', 'Claude-Data');
  const found = [];
  for (const acct of lsDirs(base)) for (const ver of lsDirs(path.join(base, acct, 'claude-code'))) for (const build of lsDirs(path.join(base, acct, 'claude-code', ver))) {
    const exe = path.join(base, acct, 'claude-code', ver, build, 'claude.exe');
    if (exists(exe)) found.push({ exe, t: fs.statSync(exe).mtimeMs });
  }
  return found.sort((a, b) => b.t - a.t)[0]?.exe;
}

// Ask Claude (haiku) for one-line Korean summaries of the skills that lack a fresh one. Writes KO_FILE.
async function fillKo() {
  const ko = attachKo();
  const todo = everySkill().filter(s => (!s.ko || s.koStale) && s.description);
  if (!todo.length) { console.log('ko summaries: nothing to fill'); return 0; }
  const claude = findClaude();
  if (!claude) { console.error('ko summaries: claude CLI not found'); return 0; }
  const items = todo.map(s => ({ id: s.id, description: s.description.slice(0, 1200) }));
  const prompt = [
    'You write one-line Korean summaries for a skill catalog page. Do not use any tools.',
    'Input (stdin) is a JSON array of {id, description}. Each description says what an AI agent skill does and when it is used.',
    'For each item write ONE Korean sentence of at most 80 characters that tells a Korean reader what the skill does and, if it fits, when to use it.',
    'Plain 해라체 statement style ending in -다 (e.g. "…를 점검하고 고친다."). Keep product and tool names in their original spelling. No marketing words, no emoji, no markdown.',
    'Output ONLY a JSON object mapping each id to its Korean summary, nothing before or after it.',
  ].join('\n');
  const out = await new Promise((resolve) => {
    const child = execFile(claude, ['-p', prompt, '--model', 'haiku', '--max-turns', '1', '--output-format', 'text'],
      { cwd: os.tmpdir(), maxBuffer: 8 * 1024 * 1024, timeout: 180000, windowsHide: true },
      (err, stdout, stderr) => { if (err) console.error('ko summaries: claude failed:', (stderr || err.message).slice(0, 300)); resolve(stdout || ''); });
    child.stdin.end(JSON.stringify(items));
  });
  const m = out.match(/\{[\s\S]*\}/);
  let got = {};
  try { got = m ? JSON.parse(m[0]) : {}; } catch { console.error('ko summaries: could not parse reply'); }
  let n = 0;
  for (const s of todo) {
    const t = typeof got[s.id] === 'string' ? got[s.id].trim() : '';
    if (t) { ko[s.id] = { ko: t, src: hash(s.description), auto: true }; n++; }
  }
  if (n) {
    const sorted = Object.fromEntries(Object.keys(ko).sort().map(k => [k, ko[k]]));
    fs.mkdirSync(path.dirname(KO_FILE), { recursive: true });
    fs.writeFileSync(KO_FILE, JSON.stringify(sorted, null, 2) + '\n');
  }
  console.log(`ko summaries: filled ${n} of ${todo.length}`);
  return n;
}

// ---------- render ----------
function render() {
  attachKo();
  const tpl = fs.readFileSync(path.join(HERE, 'catalog-template.html'), 'utf8');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  fs.writeFileSync(OUT, tpl.replace('/*__CATALOG_DATA__*/null', json));
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(data, null, 2));
}

if (args.includes('--fill-ko')) await fillKo();
render();

const nSkills = plugins.reduce((n, p) => n + p.skills.length, 0);
if (!args.includes('--quiet')) {
  console.log(`plugins ${plugins.length} (enabled ${plugins.filter(p => p.enabled).length}), plugin skills ${nSkills}, other skills ${loose.length}, ko summaries missing ${data.koMissing}`);
  console.log(`wrote ${OUT}`);
}
// --app: open in a chromeless Edge/Chrome window so it feels like a small desktop app.
function appBrowser() {
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = process.platform === 'win32'
    ? [path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'), path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
       path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'), path.join(local, 'Google\\Chrome\\Application\\chrome.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  return candidates.find(exists);
}

function openDefault(file) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  execFile(cmd[0], cmd[1], () => {});
}

if (args.includes('--app')) {
  const browser = appBrowser();
  const url = 'file:///' + OUT.replace(/\\/g, '/').replace(/^\/+/, '');
  if (browser) {
    const child = spawn(browser, [`--app=${url}`, '--window-size=1200,900'], { detached: true, stdio: 'ignore' });
    child.unref();
  } else openDefault(OUT);
  // New or changed skills without a Korean summary: fill them in the background for the next open.
  if (data.koMissing > 0 && !args.includes('--no-fill')) {
    const bg = spawn(process.execPath, [fileURLToPath(import.meta.url), '--fill-ko', '--quiet', '--out', OUT], { detached: true, stdio: 'ignore', windowsHide: true });
    bg.unref();
  }
} else if (args.includes('--open')) {
  openDefault(OUT);
}

// --install-shortcut [name]: put a desktop shortcut that regenerates the catalog and opens it as an app window.
if (args.includes('--install-shortcut')) {
  if (process.platform !== 'win32') { console.log('shortcut install is Windows-only; run `node catalog.mjs --app` instead'); process.exit(0); }
  const nameArg = argVal('--install-shortcut');
  const name = nameArg && !nameArg.startsWith('--') ? nameArg : '스킬 목록';
  const script = fileURLToPath(import.meta.url);
  const ps = `
$ws = New-Object -ComObject WScript.Shell
$desk = [Environment]::GetFolderPath('Desktop')
$lnk = $ws.CreateShortcut((Join-Path $desk '${name.replace(/'/g, "''")}.lnk'))
$lnk.TargetPath = '${process.execPath.replace(/'/g, "''")}'
$lnk.Arguments = '"${script.replace(/'/g, "''")}" --app'
$lnk.WorkingDirectory = '${HERE.replace(/'/g, "''")}'
$lnk.WindowStyle = 7
$lnk.IconLocation = "$env:SystemRoot\\System32\\imageres.dll,186"
$lnk.Description = 'Claude 스킬·플러그인 목록 (열 때마다 새로 만듦)'
$lnk.Save()
Write-Output $lnk.FullName`;
  execFile('powershell', ['-NoProfile', '-Command', ps], (err, stdout, stderr) => {
    if (err) { console.error('shortcut failed:', stderr || err.message); process.exitCode = 1; }
    else console.log('shortcut:', stdout.trim());
  });
}
