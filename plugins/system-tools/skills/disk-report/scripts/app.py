"""Disk report local app.

Opens the last report in the browser right away, re-measures the drive in the background,
and reloads the page when the new report is ready. The server stops by itself a few minutes
after the browser tab is closed. Stdlib only; binds to 127.0.0.1.

Usage: pythonw -I app.py [--drive C:] [--port 47831] [--no-browser] [--no-scan] [--idle 300]
"""
import argparse
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

ap = argparse.ArgumentParser()
ap.add_argument('--drive', default='C:')
ap.add_argument('--port', type=int, default=47831)
ap.add_argument('--no-browser', action='store_true')
ap.add_argument('--no-scan', action='store_true')
ap.add_argument('--idle', type=int, default=300, help='seconds without a browser heartbeat before the app exits')
args = ap.parse_args()

HERE = os.path.dirname(os.path.abspath(__file__))
RUN_PS1 = os.path.join(HERE, 'run.ps1')
OUT_ROOT = os.path.join(os.path.expanduser('~'), '.disk-report')
DRIVE = args.drive.rstrip('\\').upper()
KEEP_RUNS = 40
RUN_DIR_RE = re.compile(r'^\d{4}-\d{2}-\d{2}_\d{4}_' + re.escape(DRIVE[0]) + r'$')
STEP_LABEL = {1: '디스크 전체 스캔', 2: '설치된 앱 확인', 3: '디스크 정보', 4: '폴더 날짜 확인', 5: '보고서 만드는 중'}

state = {'running': False, 'step': 0, 'label': '', 'error': None, 'finished': None, 'version': 0}
lock = threading.Lock()
last_ping = [time.time()]
bound_port = [args.port]


def run_dirs():
    if not os.path.isdir(OUT_ROOT):
        return []
    names = [n for n in os.listdir(OUT_ROOT) if RUN_DIR_RE.match(n)]
    return [os.path.join(OUT_ROOT, n) for n in sorted(names, reverse=True)]


def latest_report():
    for d in run_dirs():
        p = os.path.join(d, 'report.html')
        if os.path.exists(p):
            return p
    return None


def prune():
    for d in run_dirs()[KEEP_RUNS:]:
        if os.path.dirname(d) == OUT_ROOT and RUN_DIR_RE.match(os.path.basename(d)):
            shutil.rmtree(d, ignore_errors=True)


def scan_worker():
    try:
        pwsh = shutil.which('pwsh')
        if not pwsh:
            raise RuntimeError('PowerShell 7(pwsh)을 찾지 못했어요')
        cmd = [pwsh, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', RUN_PS1, '-Drive', DRIVE, '-OutRoot', OUT_ROOT]
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             creationflags=0x08000000, text=True, encoding='utf-8', errors='replace')
        tail = []
        deadline = time.time() + 900
        for line in p.stdout:
            m = re.match(r'\[(\d)/5\]', line)
            if m:
                n = int(m.group(1))
                with lock:
                    state.update(step=n, label=STEP_LABEL.get(n, ''))
            tail = (tail + [line.strip()])[-6:]
            if time.time() > deadline:
                p.kill()
                break
        rc = p.wait()
        if rc != 0:
            raise RuntimeError((' / '.join(t for t in tail if t))[-200:] or f'종료 코드 {rc}')
        with lock:
            state.update(running=False, error=None, finished=time.time(), version=state['version'] + 1)
        prune()
    except Exception as e:  # report to the page instead of dying
        with lock:
            state.update(running=False, error=str(e)[:200])


def start_scan():
    with lock:
        if state['running']:
            return False
        state.update(running=True, step=0, label='시작', error=None)
    threading.Thread(target=scan_worker, daemon=True).start()
    return True


WAITING = ('<title>디스크 리포트</title><style>:root{--bg:#f5f6f8;--fg:#1b2230;--muted:#5d6878}'
           '@media (prefers-color-scheme: dark){:root{--bg:#12161d;--fg:#e5e9f0;--muted:#98a2b3;color-scheme:dark}}'
           'body{background:var(--bg);color:var(--fg)}main{max-width:520px;margin:20vh auto;padding:0 16px}'
           'h1{font-size:1.4rem}p{color:var(--muted);line-height:1.6}</style>'
           '<main><h1>디스크 리포트</h1><p>처음 측정하는 중이에요. 보통 20~40초 걸리고, 끝나면 이 화면이 자동으로 바뀝니다.</p></main>')

BANNER = """<style>
#drb{position:fixed;right:max(16px,env(safe-area-inset-right,0px));bottom:16px;z-index:50;display:flex;gap:10px;align-items:center;
padding:7px 7px 7px 14px;border:1px solid var(--line,#ccd);border-radius:999px;background:var(--surface,#fff);color:var(--fg,#222);
box-shadow:0 2px 12px rgba(0,0,0,.14);font:13px var(--body,system-ui,sans-serif)}
#drb button{font:inherit;padding:5px 12px;border-radius:999px;border:1px solid var(--line,#ccd);background:var(--bg,#f5f5f5);color:inherit;cursor:pointer}
#drb button:disabled{opacity:.5;cursor:default}
#drb button:focus-visible{outline:2px solid var(--accent,#2f5bd3);outline-offset:2px}
#drb[data-s=err] #drb-t{color:var(--bad,#b3372f)}
#drb .dot{width:9px;height:9px;border-radius:50%;border:2px solid var(--accent,#2f5bd3);border-top-color:transparent;animation:drbspin .8s linear infinite}
#drb[data-s=ok] .dot,#drb[data-s=err] .dot{display:none}
@keyframes drbspin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){#drb .dot{animation:none;border-top-color:var(--accent,#2f5bd3)}}
</style>
<div id="drb" role="status" aria-live="polite" data-s="run"><span class="dot"></span><span id="drb-t">최신 상태로 측정 중…</span><button id="drb-b" type="button">다시 측정</button></div>
<script>
(function(){
  var seen=__V__, t=document.getElementById('drb-t'), b=document.getElementById('drb-b'), box=document.getElementById('drb');
  function hm(ts){return new Date(ts*1000).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});}
  function tick(){
    fetch('/status',{cache:'no-store'}).then(function(r){return r.json();}).then(function(s){
      if(s.running){box.dataset.s='run';t.textContent='최신 상태로 측정 중… ('+s.step+'/5 '+s.label+')';b.disabled=true;return;}
      b.disabled=false;
      if(s.version!==seen){location.reload();return;}
      if(s.error){box.dataset.s='err';t.textContent='측정 실패: '+s.error;return;}
      box.dataset.s='ok';t.textContent=s.report_ts?('최신 · '+hm(s.report_ts)+' 측정'):'저장된 결과 없음';
    }).catch(function(){box.dataset.s='err';t.textContent='앱과 연결이 끊겼어요. 디스크 리포트를 다시 실행해 주세요.';b.disabled=true;});
  }
  b.addEventListener('click',function(){b.disabled=true;fetch('/refresh',{method:'POST'}).then(tick);});
  setInterval(tick,1500);tick();
})();
</script>"""


def page():
    rp = latest_report()
    html = WAITING
    if rp:
        with open(rp, encoding='utf-8') as f:
            html = f.read()
    return ('<!doctype html><html lang="ko"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui,sans-serif}[hidden]{display:none!important}</style>'
            '</head><body>' + html + BANNER.replace('__V__', str(state['version'])) + '</body></html>')


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'DiskReport'

    def log_message(self, *a):
        pass

    def _allowed(self):
        port = bound_port[0]
        host = (self.headers.get('Host') or '').lower()
        origin = self.headers.get('Origin')
        if host not in (f'127.0.0.1:{port}', f'localhost:{port}'):
            return False
        if origin and origin not in (f'http://127.0.0.1:{port}', f'http://localhost:{port}'):
            return False
        return True

    def _send(self, code, body, ctype='text/html; charset=utf-8'):
        b = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if not self._allowed():
            return self._send(403, 'forbidden', 'text/plain')
        path = self.path.split('?')[0]
        if path in ('/', '/index.html'):
            last_ping[0] = time.time()
            return self._send(200, page())
        if path == '/status':
            last_ping[0] = time.time()
            rp = latest_report()
            with lock:
                out = dict(state, report_ts=os.path.getmtime(rp) if rp else None)
            return self._send(200, json.dumps(out), 'application/json')
        if path == '/ping':
            return self._send(200, 'disk-report-app', 'text/plain')
        self._send(404, 'not found', 'text/plain')

    def do_POST(self):
        if not self._allowed():
            return self._send(403, 'forbidden', 'text/plain')
        if self.path.split('?')[0] == '/refresh':
            last_ping[0] = time.time()
            return self._send(200, json.dumps({'started': start_scan()}), 'application/json')
        self._send(404, 'not found', 'text/plain')


class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address = False  # on Windows, reuse would let a second copy bind the same port
    daemon_threads = True


def opener():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def is_ours(port):
    try:
        return opener().open(f'http://127.0.0.1:{port}/ping', timeout=1.5).read() == b'disk-report-app'
    except Exception:
        return False


def idle_watch():
    while True:
        time.sleep(10)
        with lock:
            busy = state['running']
        if not busy and time.time() - last_ping[0] > args.idle:
            os._exit(0)


def main():
    srv = None
    for port in range(args.port, args.port + 10):
        try:
            srv = Server(('127.0.0.1', port), Handler)
            bound_port[0] = port
            break
        except OSError:
            if is_ours(port):  # already running: ask it to refresh and just open the browser
                if not args.no_scan:
                    try:
                        req = urllib.request.Request(f'http://127.0.0.1:{port}/refresh', method='POST',
                                                     headers={'Origin': f'http://127.0.0.1:{port}'})
                        opener().open(req, timeout=3).read()
                    except Exception:
                        pass
                if not args.no_browser:
                    webbrowser.open(f'http://127.0.0.1:{port}/')
                return
    if srv is None:
        return
    if not args.no_scan:
        start_scan()
    threading.Thread(target=idle_watch, daemon=True).start()
    if not args.no_browser:
        webbrowser.open(f'http://127.0.0.1:{bound_port[0]}/')
    srv.serve_forever()


if __name__ == '__main__':
    main()
