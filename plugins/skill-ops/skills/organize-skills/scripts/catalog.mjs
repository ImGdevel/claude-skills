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
  plugins.push(describePlugin({ key, market, root, loadsInPlace, version: rec.version, lastUpdated: rec.lastUpdated || rec.installedAt,
    enabled: enabled[key] === true, source: sourceLabel(km.source), autoUpdate: extra[market]?.autoUpdate === true }));
}

// Plugins the desktop app syncs from the claude.ai account (~/.claude/plugins/synced/<bucket>/<dir>).
// They are not in installed_plugins.json; the CLI lists them as <name>@synced.
for (const bucket of lsDirs(path.join(CLAUDE, 'plugins', 'synced'))) {
  const bdir = path.join(CLAUDE, 'plugins', 'synced', bucket);
  const man = readJson(path.join(bdir, 'manifest.json'), { plugins: [] });
  for (const dir of lsDirs(bdir)) {
    const root = path.join(bdir, dir);
    const pj = readJson(path.join(root, '.claude-plugin', 'plugin.json'));
    if (!pj) continue;
    const m = (man.plugins || []).find(p => p.name === dir) || {};
    const key = `${pj.name || dir}@synced`;
    plugins.push(describePlugin({ key, market: 'synced', root, loadsInPlace: false, version: pj.version, lastUpdated: m.updatedAt,
      enabled: enabled[key] !== false,
      source: { kind: 'synced', label: `claude.ai 계정 동기화${m.marketplaceName ? ' · ' + m.marketplaceName : ''}` }, autoUpdate: true }));
  }
}

function describePlugin({ key, market, root, loadsInPlace, version, lastUpdated, enabled: on, source, autoUpdate }) {
  const pname = key.split('@')[0];
  const manifest = readJson(path.join(root, '.claude-plugin', 'plugin.json')) || readJson(path.join(root, 'plugin.json')) || {};
  const skills = [];
  for (const d of skillDirs(root, manifest.skills)) {
    try { skills.push(readSkill(d, pname)); } catch (e) { skills.push({ name: path.basename(d), id: `${pname}:${path.basename(d)}`, error: String(e.message) }); }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return {
    key, name: pname, marketplace: market,
    enabled: on,
    version: manifest.version || version,
    description: manifest.description || '',
    author: manifest.author?.name || '',
    license: manifest.license || '',
    homepage: manifest.homepage || manifest.repository || '',
    source,
    autoUpdate,
    loadsInPlace,
    root,
    lastUpdated,
    hasSourceNote: exists(path.join(root, 'SOURCE.md')),
    skills,
    agents: countMd(root, manifest.agents, './agents'),
    commands: countMd(root, manifest.commands, './commands'),
    hooks: hookEvents(root, manifest),
    mcp: mcpServers(root, manifest),
  };
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

// ---------- who made it ----------
// Most specific wins: data/skill-origins.json exact id → '<plugin>:*' → SKILL.md author → plugin.json author.
{
  const origins = readJson(path.join(HERE, '..', 'data', 'skill-origins.json'), {});
  for (const p of plugins) for (const s of p.skills) {
    const o = origins[s.id] || origins[`${p.name}:*`];
    s.origin = o ? { author: o.author, url: o.url || '' } : { author: s.author || p.author || '알 수 없음', url: p.homepage || p.source.url || '' };
  }
  for (const s of loose) {
    const o = origins[s.kind === 'synced' ? `synced:${s.name}` : `link:${s.name}`] || origins[`${s.kind === 'synced' ? 'synced' : 'link'}:*`];
    s.origin = s.kind === 'synced' && s.note !== 'Anthropic 제공' ? { author: '내 claude.ai 스킬', url: '' } : o ? { author: o.author, url: o.url || '' } : { author: s.author || '직접 만듦', url: '' };
  }
}

// ---------- how often each skill was used ----------
// Counts Skill tool calls and /slash commands in Claude Code session logs (~/.claude/projects/**/*.jsonl).
// Logs older than cleanupPeriodDays (default 30) are deleted by Claude Code, so this only covers that window.
// Per-file counts are cached by mtime+size, so only new or changed logs are read again.
function collectUsage() {
  const root = path.join(CLAUDE, 'projects');
  const cacheFile = path.join(CLAUDE, 'skill-catalog-usage.json');
  const cache = readJson(cacheFile, { files: {} });
  const next = { files: {} };
  const reSkill = /"name":"Skill","input":\{"skill":"([^"]+)"/g;
  const reCmd = /<command-name>\/([^<\s]+)<\/command-name>/g;
  let oldest = Infinity;
  for (const dir of lsDirs(root)) for (const f of lsFiles(path.join(root, dir), '.jsonl')) {
    const fp = path.join(root, dir, f);
    let st; try { st = fs.statSync(fp); } catch { continue; }
    const key = `${st.mtimeMs}:${st.size}`;
    let entry = cache.files[fp];
    if (!entry || entry.key !== key) {
      const counts = {};
      let first = null;
      try {
        const text = fs.readFileSync(fp, 'utf8');
        const ts = text.match(/"timestamp":"([^"]+)"/); first = ts ? Date.parse(ts[1]) : st.mtimeMs;
        for (const m of text.matchAll(reSkill)) counts[m[1]] = (counts[m[1]] || 0) + 1;
        for (const m of text.matchAll(reCmd)) counts['/' + m[1]] = (counts['/' + m[1]] || 0) + 1;
      } catch {}
      entry = { key, counts, first, last: st.mtimeMs };
    }
    next.files[fp] = entry;
    oldest = Math.min(oldest, entry.last); // last activity of the oldest kept log ≈ start of the retention window
  }
  try { fs.writeFileSync(cacheFile, JSON.stringify(next)); } catch {}

  // Map raw names to catalog ids. A bare name (from before a skill moved into a plugin) counts for
  // the one skill with that name; slash commands count only when they name a skill.
  const all = everySkill();
  const byId = new Map(all.map(s => [s.id, s]));
  const byName = new Map();
  for (const s of all) byName.set(s.name, byName.has(s.name) ? null : s);
  for (const s of all) { s.uses = 0; s.lastUsed = null; }
  for (const e of Object.values(next.files)) for (const [raw, n] of Object.entries(e.counts)) {
    const name = raw.replace(/^\//, '');
    const s = byId.get(name) || byName.get(name) || byName.get(name.split(':').pop());
    if (!s) continue;
    s.uses += n;
    s.lastUsed = Math.max(s.lastUsed || 0, e.last);
  }
  data.usageSince = Number.isFinite(oldest) ? new Date(oldest).toISOString() : null;
  data.usageSessions = Object.keys(next.files).length;
}

// ---------- automatic checks ----------
function hookCommands(root, manifest) {
  let h = manifest.hooks;
  if (typeof h === 'string') h = readJson(path.resolve(root, h), {})?.hooks;
  if (!h) h = readJson(path.join(root, 'hooks', 'hooks.json'), {})?.hooks;
  const out = [];
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (typeof v.command === 'string') out.push(v.command); Object.values(v).forEach(walk); } };
  walk(h);
  return out;
}

function runChecks() {
  const issues = [];
  // 1. The same hook script registered both by a plugin and by hand in settings.json runs twice.
  const settingsCmds = [];
  for (const arr of Object.values(settings.hooks || {})) for (const g of arr) for (const x of g.hooks || []) if (x.command) settingsCmds.push(x.command);
  const scriptName = (c) => (c.match(/([\w.-]+\.(?:js|mjs|cjs|py|ps1|sh|cmd))/g) || []);
  for (const p of plugins.filter(p => p.enabled)) {
    const manifest = readJson(path.join(p.root, '.claude-plugin', 'plugin.json')) || {};
    const pnames = new Set(hookCommands(p.root, manifest).flatMap(scriptName));
    const dup = settingsCmds.filter(c => scriptName(c).some(n => pnames.has(n)));
    if (dup.length) issues.push({ level: 'warn', title: `${p.name} 훅이 두 번 실행됨`, detail: `플러그인이 등록한 훅과 같은 스크립트가 ~/.claude/settings.json의 hooks에도 직접 등록돼 있습니다. 매 세션·매 메시지마다 같은 지시가 두 번 들어갑니다: ${dup.map(c => scriptName(c).join(' ')).join(', ')}` });
  }
  // 2. Same skill name in more than one place: the short name becomes ambiguous.
  const seen = {};
  for (const s of everySkill()) (seen[s.name] ||= []).push(s.id);
  for (const [n, ids] of Object.entries(seen)) if (ids.length > 1) issues.push({ level: 'info', title: `같은 이름의 스킬: ${n}`, detail: ids.join(', ') });
  // 3. Skills that need an MCP server which is not configured.
  const cfg = readJson(path.join(HOME, '.claude.json'), {});
  const mcpNames = new Set([...Object.keys(cfg.mcpServers || {}), ...Object.values(cfg.projects || {}).flatMap(v => Object.keys(v.mcpServers || {})), ...plugins.flatMap(p => p.mcp)]);
  for (const s of plugins.filter(p => p.enabled).flatMap(p => p.skills)) {
    const need = /chrome devtools mcp|chrome-devtools mcp/i.test(s.description) ? 'chrome-devtools' : null;
    if (need && ![...mcpNames].some(n => n.includes(need))) issues.push({ level: 'warn', title: `${s.id}: 필요한 MCP 없음`, detail: `이 스킬은 ${need} MCP 서버가 있어야 제대로 동작하는데 설정에 없습니다.` });
  }
  data.issues = issues;
}

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
  collectUsage();
  runChecks();
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
