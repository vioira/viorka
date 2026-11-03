#!/usr/bin/env python3
"""Opt-in local browser integration fixture: real Panel, TLS proxy and Agent.
All listeners are loopback, all credentials/database/state are temporary. No
existing service, default port or user configuration is touched. Stop with SIGINT
or SIGTERM; the fixture has a two-hour maximum lifetime and preserves private logs.
"""
import argparse
import http.cookiejar
import json
import os
import pathlib
import secrets
import signal
import socket
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--agent', type=pathlib.Path, default=ROOT.parent / 'viorka-agent')
p.add_argument('--remote-agent', action='store_true', help='write enrollment input for a separately launched isolated Linux Agent instead of starting a local one')
p.add_argument('--minutes', type=int, default=60)
args = p.parse_args()
if not 1 <= args.minutes <= 120:
    p.error('--minutes must be 1..120')
work = pathlib.Path(tempfile.mkdtemp(prefix='viorka-browser-'))
os.chmod(work, 0o700)
processes = []
log = (work / 'process.log').open('w')

def save(name, value):
    path = work / name
    path.write_text(value)
    path.chmod(0o600)
    return path

def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

def start(command, env=None):
    child = subprocess.Popen(command, env=env, stdout=log, stderr=log)
    processes.append(child)
    return child

def interrupted(_number, _frame):
    raise KeyboardInterrupt

signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)
try:
    subprocess.run(['pnpm', 'build'], cwd=ROOT / 'web', stdout=log, stderr=log, check=True)
    subprocess.run(['go', 'build', '-trimpath', '-o', str(work / 'panel'), './cmd/server'], cwd=ROOT, stdout=log, stderr=log, check=True)
    if not args.remote_agent:
        subprocess.run(['go', 'build', '-trimpath', '-o', str(work / 'agent'), './cmd/viorka-agent'], cwd=args.agent, stdout=log, stderr=log, check=True)
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(work / 'key.pem'), '-out', str(work / 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], stdout=log, stderr=log, check=True)
    (work / 'key.pem').chmod(0o600)
    backend, frontend = port(), port()
    while frontend == backend:
        frontend = port()
    origin = f'https://127.0.0.1:{frontend}'
    # The frontend and Agent share one verified TLS origin. ReverseProxy supports
    # real websocket upgrades and SSE; SPA fallback serves only static web files.
    source = save('proxy.go', '''package main
import("crypto/tls";"log";"net/http";"net/http/httputil";"net/url";"os";"path/filepath";"strings";"time")
func main(){
 target,_:=url.Parse(os.Args[1]);proxy:=httputil.NewSingleHostReverseProxy(target)
 proxy.FlushInterval=-1
 root:=os.Args[2];files:=http.FileServer(http.Dir(root))
 h:=http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  if strings.HasPrefix(r.URL.Path,"/api/") || r.URL.Path=="/healthz" || r.URL.Path=="/readyz" {proxy.ServeHTTP(w,r);return}
  path:=filepath.Join(root,filepath.Clean("/"+r.URL.Path))
  if st,e:=os.Stat(path);e!=nil || st.IsDir(){http.ServeFile(w,r,filepath.Join(root,"index.html"));return}
  files.ServeHTTP(w,r)
 })
 server:=&http.Server{Addr:os.Args[3],Handler:h,ReadHeaderTimeout:5*time.Second,IdleTimeout:60*time.Second,TLSConfig:&tls.Config{MinVersion:tls.VersionTLS12}}
 log.Fatal(server.ListenAndServeTLS(os.Args[4],os.Args[5]))
}
''')
    subprocess.run(['go', 'build', '-o', str(work / 'proxy'), str(source)], stdout=log, stderr=log, check=True)
    password = secrets.token_urlsafe(24)
    password_file = save('password', password)
    env = os.environ.copy()
    # Explicit values prevent inherited development .env from selecting user data.
    env.update(VIORKA_LISTEN=f'127.0.0.1:{backend}', VIORKA_ORIGIN=origin,
               VIORKA_DATABASE=str(work / 'panel.db'), VIORKA_ADMIN_USERNAME='admin',
               VIORKA_ADMIN_PASSWORD_FILE=str(password_file), VIORKA_TELEMETRY_V3='true',
               VIORKA_TLS_CERT='', VIORKA_TLS_KEY='', VIORKA_ALLOWED_ORIGINS='', VIORKA_ENV_FILE=str(save('empty.env', '')))
    start([str(work / 'panel')], env)
    start([str(work / 'proxy'), f'http://127.0.0.1:{backend}', str(ROOT / 'web' / 'dist'), f'127.0.0.1:{frontend}', str(work / 'cert.pem'), str(work / 'key.pem')])
    context = ssl.create_default_context(cafile=str(work / 'cert.pem'))
    client = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    csrf = ''
    def api(path, method='GET', data=None):
        request = urllib.request.Request(origin + path, method=method, data=json.dumps(data).encode() if data is not None else None,
                                         headers={'Content-Type':'application/json', 'Origin':origin, 'X-CSRF-Token':csrf})
        with client.open(request, timeout=5) as response:
            return json.load(response) if response.status != 204 else None
    deadline = time.monotonic() + 30
    while True:
        try:
            api('/readyz')
            break
        except (urllib.error.URLError, ConnectionError):
            if any(child.poll() is not None for child in processes) or time.monotonic() >= deadline:
                raise RuntimeError('fixture startup failed; inspect private process.log')
            time.sleep(0.2)
    csrf = api('/api/v1/auth/login', 'POST', {'username':'admin', 'password':password})['csrf_token']
    node = api('/api/v1/nodes', 'POST', {'name':'Monitoring integration node', 'kind':'vps'})
    save('enrollment-token', node['token'])
    config = {'panel_url':origin, 'node_name':'Monitoring integration node', 'state_dir':str(work / 'agent-state'), 'ca_file':str(work / 'cert.pem'), 'telemetry_v3':True}
    cfg = save('agent.json', json.dumps(config))
    if not args.remote_agent:
        subprocess.run([str(work / 'agent'), 'enroll', '--config', str(cfg), '--token-stdin'], input=node['token'], text=True, stdout=log, stderr=log, check=True, timeout=20)
        start([str(work / 'agent'), 'run', '--config', str(cfg)])
        (work / 'enrollment-token').unlink()
    # Pending nodes exercise real pagination without fabricating metric data.
    for i in range(60):
        api('/api/v1/nodes', 'POST', {'name':f'Pagination fixture {i+1:02}', 'kind':'vps'})
    save('fixture.json', json.dumps({'origin':origin, 'frontend_port':frontend, 'node_id':node['id'], 'username':'admin', 'password_file':str(password_file), 'remote_agent':args.remote_agent}))
    print(json.dumps({'origin':origin, 'fixture':str(work / 'fixture.json'), 'log':str(work / 'process.log')}), flush=True)
    deadline = time.monotonic() + args.minutes * 60
    while time.monotonic() < deadline:
        if any(child.poll() is not None for child in processes):
            raise RuntimeError('fixture child exited; inspect private process.log')
        time.sleep(1)
except KeyboardInterrupt:
    pass
finally:
    for child in reversed(processes):
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
    log.close()
    print('Fixture stopped; private artifacts preserved at ' + str(work), flush=True)
