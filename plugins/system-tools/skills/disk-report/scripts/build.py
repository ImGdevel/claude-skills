"""Disk report builder.

Usage:
  python -I build.py targets <work_dir> <skill_scripts_dir>   -> work_dir/targets.txt
  python -I build.py report  <work_dir> <skill_scripts_dir>   -> work_dir/data.json, work_dir/report.html
Inputs in work_dir: scan.json (fullscan.ps1), apps.json (apps.ps1), newest.json (newest.ps1), disk.json (run.ps1)
"""
import json, re, os, sys, glob, datetime

BS = chr(92)
GB = 2 ** 30
MB = 2 ** 20
mode, WORK, SK = sys.argv[1], sys.argv[2], sys.argv[3]
W = lambda n: os.path.join(WORK, n)

scan = json.load(open(W('scan.json'), encoding='utf-8-sig'))
ROOT = scan['root']                      # e.g. C:\
DRV = ROOT[:2].upper()                   # C:
def rel(p):                              # absolute -> drive-relative (no leading backslash)
    p = p.replace('/', BS).rstrip(BS)
    return p[3:] if p[:2].upper() == DRV else None
def ab(r): return DRV + BS + r

size = {}
for d in scan['dirs']:
    p = d['p']
    if p[:2].upper() == DRV: p = p[3:]
    size[p] = d['b']
sizel = {k.lower(): v for k, v in size.items()}
def g(r): return sizel.get((r or '').lower(), 0)

prof = os.environ.get('USERPROFILE', '')
U = rel(prof) or ('Users' + BS + os.environ.get('USERNAME', ''))

# ---------------- game libraries ----------------
def steam_info():
    roots, last, manifests = [], {}, {}
    try:
        import winreg
        k = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Valve\Steam')
        sp = winreg.QueryValueEx(k, 'SteamPath')[0].replace('/', BS)
        roots.append(sp)
    except Exception:
        return roots, last, manifests
    lf = os.path.join(roots[0], 'steamapps', 'libraryfolders.vdf')
    if os.path.exists(lf):
        for m in re.finditer(r'"path"\s*"([^"]+)"', open(lf, encoding='utf-8', errors='ignore').read()):
            p = m.group(1).replace(BS + BS, BS)
            if p.lower() not in [r.lower() for r in roots]: roots.append(p)
    for f in glob.glob(os.path.join(roots[0], 'userdata', '*', 'config', 'localconfig.vdf')):
        t = open(f, encoding='utf-8', errors='ignore').read()
        for m in re.finditer(r'"(\d+)"\s*\{[^{}]*?"LastPlayed"\s*"(\d+)"', t):
            last[m.group(1)] = max(last.get(m.group(1), 0), int(m.group(2)))
    for r in roots:
        for f in glob.glob(os.path.join(r, 'steamapps', 'appmanifest_*.acf')):
            t = open(f, encoding='utf-8', errors='ignore').read()
            try:
                appid = re.search(r'"appid"\s*"(\d+)"', t).group(1)
                name = re.search(r'"name"\s*"([^"]*)"', t).group(1)
                inst = re.search(r'"installdir"\s*"([^"]*)"', t).group(1)
            except AttributeError:
                continue
            ts = last.get(appid)
            manifests[os.path.join(r, 'steamapps', 'common', inst).lower()] = {
                'name': name, 'last': datetime.date.fromtimestamp(ts).isoformat() if ts else None}
    return roots, last, manifests

def epic_games():
    out = []
    for f in glob.glob(os.path.join(os.environ.get('ProgramData', r'C:\ProgramData'), 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests', '*.item')):
        try:
            j = json.load(open(f, encoding='utf-8', errors='ignore'))
            if j.get('InstallLocation'): out.append({'name': j.get('DisplayName') or j.get('AppName'), 'loc': j['InstallLocation'].replace('/', BS)})
        except Exception:
            pass
    return out

steam_roots, _, steam_games = steam_info()
epic = epic_games()
game_dirs = []   # (drive-relative path, name)
for loc, info in steam_games.items():
    r = rel(loc)
    if r and g(r): game_dirs.append((r, info['name']))
for e in epic:
    r = rel(e['loc'])
    if r and g(r): game_dirs.append((r, e['name']))
for p in size:
    if re.match(r'^(.*\\)?Riot Games\\[^\\]+$', p, re.I) and p.count(BS) <= 3 and size[p] >= 300 * MB:
        game_dirs.append((p, p.split(BS)[-1]))

# ---------------- targets (folders whose newest-file date we want) ----------------
if mode == 'targets':
    Ue = re.escape(U)
    pats = [rf'^{Ue}\\AppData\\(Local|Roaming|LocalLow)\\[^\\]+$', r'^ProgramData\\[^\\]+$', r'^Program Files( \(x86\))?\\[^\\]+$',
            r'^Games\\[^\\]+\\[^\\]+$', rf'^{Ue}\\[^\\]+$', rf'^{Ue}\\workspace\\[^\\]+$']
    out = {p for p in size if size[p] >= 300 * MB and any(re.match(x, p, re.I) for x in pats)}
    out |= {p for p, _ in game_dirs}
    apps = json.load(open(W('apps.json'), encoding='utf-8-sig'))['apps']
    for a in apps:
        r = rel(a['location'] or '')
        if r and g(r) >= 50 * MB: out.add(r)
    open(W('targets.txt'), 'w', encoding='utf-8').write('\n'.join(ab(p) for p in sorted(out)))
    print(f'targets: {len(out)}')
    sys.exit(0)

# ---------------- report ----------------
apps_raw = json.load(open(W('apps.json'), encoding='utf-8-sig'))
nw = {x['p'].lower().rstrip(BS): x['t'] for x in json.load(open(W('newest.json'), encoding='utf-8-sig'))}
disk = json.load(open(W('disk.json'), encoding='utf-8-sig'))
cfg = json.load(open(os.path.join(SK, 'categories.json'), encoding='utf-8'))

def children(prefix):
    depth = prefix.count(BS) + 1 if prefix else 0
    res = []
    for p, b in size.items():
        if prefix == '':
            if BS not in p: res.append((p, b))
        elif p.lower().startswith(prefix.lower() + BS) and p.count(BS) == depth:
            res.append((p, b))
    return sorted(res, key=lambda x: -x[1])

def node(p, b, lvl):
    n = {'n': p.split(BS)[-1], 'b': b}
    if lvl < 5:
        ch = children(p)
        if ch:
            kids = [node(cp, cb, lvl + 1) for cp, cb in ch[:40]]
            rest = b - sum(c['b'] for c in kids)
            if rest > 200 * MB: kids.append({'n': '(작은 파일·폴더 합계)', 'b': rest})
            n['c'] = kids
    return n
tree = [node(p, b, 0) for p, b in children('')]

# categories: first match wins, no overlap
claimed = []
cats = []
for c in cfg['categories']:
    paths = [p.replace('{U}', U) for p in c['paths']]
    if c.get('games'): paths += [p for p, _ in game_dirs]
    items = []
    for p in paths:
        pl = p.lower()
        if not g(p): continue
        if any(pl == x or pl.startswith(x + BS) for x in claimed): continue
        b = g(p) - sum(g(x) for x in claimed if x.startswith(pl + BS))
        items.append((p, b)); claimed.append(pl)
    cats.append({'name': c['name'], 'note': c.get('note', ''), 'b': sum(b for _, b in items),
                 'items': sorted([{'p': ab(p) if p != '(root files)' else ab('hiberfil.sys + pagefile.sys + swapfile.sys'), 'b': b} for p, b in items], key=lambda x: -x['b'])})

rest = []
def sweep(prefix):
    for p, b in children(prefix):
        pl = p.lower()
        if any(pl == x or pl.startswith(x + BS) for x in claimed): continue
        if any(x.startswith(pl + BS) for x in claimed):
            sweep(p)
            leftover = b - sum(b2 for _, b2 in children(p))
            if leftover > 100 * MB: rest.append({'p': ab(p) + BS + '(작은 항목들)', 'b': leftover})
        else:
            rest.append({'p': ab(p), 'b': b})
sweep('')
rest.sort(key=lambda x: -x['b'])
cats.append({'name': '기타 앱 · 데이터', 'note': '위 분류에 안 들어간 나머지 앱과 데이터. 큰 항목이 보이면 categories.json에 분류를 추가하세요.', 'b': sum(r['b'] for r in rest), 'items': rest[:60]})
used = disk['size'] - disk['free']
cats.append({'name': '측정 불가 (시스템 보호 영역)', 'note': '시스템 복원 지점, 파일 시스템 내부 기록처럼 열 수 없는 영역. 사용량에서 측정값을 뺀 나머지입니다.', 'b': max(used - scan['scannedBytes'], 0), 'items': []})
cats.sort(key=lambda c: -c['b'])

# installed apps + last use
steam_lib_roots = {(rel(r) or '').lower() for r in steam_roots}
epic_root_like = {x.lower() for x in ['Games' + BS + 'Epic Games', 'Program Files' + BS + 'Epic Games']}
apps = []
for x in apps_raw['apps']:
    loc = (x['location'] or '').replace('/', BS).rstrip(BS)
    r = rel(loc) if loc else None
    if r and r.lower().startswith('windows'): continue
    b = g(r) if r else 0
    rl = (r or '').lower()
    if rl in steam_lib_roots or rl in epic_root_like:
        if 'steam' in x['name'].lower():
            b = g(r) - g(r + BS + 'steamapps' + BS + 'common')
        elif 'epic games launcher' in x['name'].lower():
            b = g(r + BS + 'Launcher')
        else:
            continue
    if not b and x.get('regKB'): b = x['regKB'] * 1024
    last, src = x.get('lastRun'), ('실행 기록' if x.get('lastRun') else None)
    sg = steam_games.get(loc.lower())
    if sg and sg['last']: last, src = sg['last'], 'Steam 플레이 기록'
    if not last and loc:
        t = nw.get(loc.lower())
        if t: last, src = t, '폴더 최근 변경일'
    apps.append({'name': x['name'], 'loc': loc, 'b': b or 0, 'last': last, 'src': src})
known = {a['loc'].lower() for a in apps if a['loc']}
for r, name in game_dirs:
    full = ab(r)
    if full.lower() in known: continue
    sg = steam_games.get(full.lower())
    last, src = (sg['last'], 'Steam 플레이 기록') if sg and sg['last'] else (nw.get(full.lower()), '폴더 최근 변경일')
    apps.append({'name': name, 'loc': full, 'b': g(r), 'last': last, 'src': src})
seen = {}
for a in sorted(apps, key=lambda x: (-round(x['b'] / 2 ** 28), x['last'] is None)):
    k = re.sub(r'\\live$', '', (a['loc'] or a['name']).lower())
    if k in seen or any(a['name'].strip().lower() == v['name'].strip().lower() for v in seen.values()): continue
    seen[k] = a
apps = sorted(seen.values(), key=lambda x: -x['b'])

# AppData / ProgramData folders vs installed apps
names = re.sub(r'[^a-z0-9]', '', ' '.join(((a['name'] or '') + (a['publisher'] or '') + (a['location'] or '')) for a in apps_raw['apps']).lower())
names += re.sub(r'[^a-z0-9]', '', ' '.join(n for _, n in game_dirs).lower())
system_like = {'microsoft', 'packages', 'temp', 'programs', 'nvidia', 'nvidiacorporation', 'packagecache', 'crashdumps', 'd3dscache',
               'connecteddevicesplatform', 'google', 'mozilla', 'npmcache', 'npm', 'pip', 'python', 'docker', 'wsl', 'claudedata', 'claude', 'uv'}
Ue = re.escape(U)
appdata = []
for p, b in size.items():
    m = re.match(rf'^({Ue}\\AppData\\(Local|Roaming|LocalLow)|ProgramData)\\([^\\]+)$', p, re.I)
    if not m or b < 200 * MB: continue
    key = re.sub(r'[^a-z0-9]', '', m.group(3).lower())
    installed = key in system_like or (len(key) >= 3 and key in names)
    appdata.append({'p': ab(p), 'b': b, 'last': nw.get(ab(p).lower()), 'installed': installed})
appdata.sort(key=lambda x: -x['b'])

def fsize(name):
    p = ROOT + name
    try: return os.path.getsize(p)
    except OSError: return 0
extra = {'hiberfil': fsize('hiberfil.sys'), 'pagefile': fsize('pagefile.sys'),
         'claude': g(U + BS + r'AppData\Local\Claude-Data'), 'codex': g(U + BS + '.codex'),
         'codexSessions': g(U + BS + r'.codex\sessions'), 'codexImages': g(U + BS + r'.codex\generated_images')}

# previous run for comparison
prev = None
parent = os.path.dirname(os.path.abspath(WORK))
cands = []
for dname in os.listdir(parent):
    dpath = os.path.join(parent, dname)
    pd = os.path.join(dpath, 'data.json')
    if os.path.abspath(dpath) == os.path.abspath(WORK) or not os.path.exists(pd): continue
    try:
        pj = json.load(open(pd, encoding='utf-8'))
        if pj.get('drive') == DRV and pj.get('scanned'):
            datetime.datetime.strptime(pj['scanned'], '%Y-%m-%d %H:%M')
            cands.append(pj)
    except Exception:
        pass
cands.sort(key=lambda j: j['scanned'])
# On-demand runs can be minutes apart. Compare with the newest run that is at least 6h old,
# otherwise with the oldest run we have, so the delta shows real change instead of ~0.
def age_h(j): return (datetime.datetime.now() - datetime.datetime.strptime(j['scanned'], '%Y-%m-%d %H:%M')).total_seconds() / 3600
older = [j for j in cands if age_h(j) >= 6]
pick = older[-1] if older else (cands[0] if cands else None)
if pick:
    prev = {'scanned': pick['scanned'], 'used': pick['disk']['used'], 'cats': {c['name']: c['b'] for c in pick['cats']}}

data = {'drive': DRV, 'scanned': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), 'model': disk.get('model', ''),
        'disk': {'size': disk['size'], 'free': disk['free'], 'used': used, 'measured': scan['scannedBytes'], 'files': scan['files']},
        'cats': cats, 'tree': tree, 'apps': apps, 'appdata': appdata, 'extra': extra, 'prev': prev}
json.dump(data, open(W('data.json'), 'w', encoding='utf-8'), ensure_ascii=False)
html = open(os.path.join(SK, 'template.html'), encoding='utf-8').read()
html = html.replace('/*DATA*/null', json.dumps(data, ensure_ascii=False).replace('</', '<' + BS + '/'))
open(W('report.html'), 'w', encoding='utf-8').write(html)

lines = [f"used {used/GB:.1f}GB / measured {scan['scannedBytes']/GB:.1f}GB / free {disk['free']/GB:.1f}GB / total {disk['size']/GB:.0f}GB"]
if prev: lines.append(f"previous scan {prev['scanned']}: used {prev['used']/GB:.1f}GB ({(used - prev['used'])/GB:+.1f}GB)")
for c in cats:
    delta = ''
    if prev and c['name'] in prev['cats']:
        dlt = (c['b'] - prev['cats'][c['name']]) / GB
        if abs(dlt) >= 0.1: delta = f'  ({dlt:+.1f}GB)'
    lines.append(f"{c['b']/GB:7.1f}GB  {c['name']}{delta}")
old = [a for a in apps if a['b'] >= GB and (not a['last'] or (datetime.date.today() - datetime.date.fromisoformat(a['last'])).days > 90)]
if old: lines.append('apps >=1GB unused 90d+ or no record: ' + ', '.join(f"{a['name']} {a['b']/GB:.1f}GB ({a['last'] or 'none'})" for a in old))
orph = [x for x in appdata if not x['installed']][:8]
if orph: lines.append('appdata without matching app: ' + ', '.join(f"{x['p']} {x['b']/GB:.1f}GB" for x in orph))
lines.append('report: ' + W('report.html'))
open(W('summary.txt'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
print('\n'.join(lines))
