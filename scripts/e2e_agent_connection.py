#!/usr/bin/env python3
"""Local two-process TLS fault test. Requires sibling viorka-agent, Go and OpenSSL.
No production data, inbound Agent listener or proxy engine is used.
"""
import argparse, http.cookiejar, json, os, pathlib, secrets, socket, ssl, subprocess, tempfile, time, urllib.request, urllib.error
root = pathlib.Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(); p.add_argument('--agent', type=pathlib.Path, default=root.parent/'viorka-agent'); args = p.parse_args()
def wait_for(fn, timeout=45):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        try:
            value=fn()
            if value: return value
        except (urllib.error.URLError, ConnectionError): pass
        time.sleep(.2)
    raise AssertionError('condition timed out')
with tempfile.TemporaryDirectory(prefix='viorka-agent-connection-') as directory:
    d=pathlib.Path(directory); env=os.environ.copy(); env.setdefault('GOCACHE','/tmp/viorka-go-cache')
    subprocess.run(['go','build','-o',str(d/'panel'),'./cmd/server'],cwd=root,env=env,check=True)
    subprocess.run(['go','build','-o',str(d/'agent'),'./cmd/viorka-agent'],cwd=args.agent,env=env,check=True)
    subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(d/'key.pem'),'-out',str(d/'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    with socket.socket() as s:s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
    origin=f'https://127.0.0.1:{port}'; password=secrets.token_urlsafe(24); (d/'password').write_text(password);(d/'password').chmod(0o600)
    env.update(VIORKA_LISTEN=f'127.0.0.1:{port}',VIORKA_ORIGIN=origin,VIORKA_DATABASE=str(d/'panel.db'),VIORKA_ADMIN_USERNAME='admin',VIORKA_ADMIN_PASSWORD_FILE=str(d/'password'),VIORKA_TLS_CERT=str(d/'cert.pem'),VIORKA_TLS_KEY=str(d/'key.pem'))
    config={'panel_url':origin,'node_name':'NAT outbound test','state_dir':str(d/'agent-state'),'log_level':'warn','ca_file':str(d/'cert.pem')};(d/'agent.json').write_text(json.dumps(config))
    context=ssl.create_default_context(cafile=str(d/'cert.pem'));cookies=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPSHandler(context=context),urllib.request.HTTPCookieProcessor(cookies));csrf=''
    def api(path,method='GET',data=None):
        req=urllib.request.Request(origin+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json','Origin':origin,'X-CSRF-Token':csrf})
        with client.open(req,timeout=3) as res:return json.load(res) if res.status!=204 else None
    log=open(d/'process.log','w');panel=agent=sentinel=None
    try:
        panel=subprocess.Popen([str(d/'panel')],env=env,stdout=log,stderr=log)
        wait_for(lambda: api('/readyz'));session=api('/api/v1/auth/login','POST',{'username':'admin','password':password});csrf=session['csrf_token']
        token=api('/api/v1/enrollment-tokens','POST',{'name':'NAT outbound test','kind':'nat'})['token']
        subprocess.run([str(d/'agent'),'enroll','--config',str(d/'agent.json'),'--token-stdin'],input=token,text=True,stdout=log,stderr=log,timeout=20,check=True)
        agent=subprocess.Popen([str(d/'agent'),'run','--config',str(d/'agent.json')],stdout=log,stderr=log)
        # Independent existing process stands in for unrelated node workloads.
        sentinel=subprocess.Popen(['sleep','180'])
        def online():
            items=api('/api/v1/nodes')['items'];return items[0] if items and items[0]['state']=='online' else None
        node=wait_for(online);body={'operation':'node.inspect','idempotency_key':'restart-safe'}
        task=api(f"/api/v1/nodes/{node['id']}/tasks",'POST',body)
        result=wait_for(lambda: (v if (v:=api('/api/v1/tasks/'+task['id']))['state']=='succeeded' else None))
        assert result['result']['inspection']['hostname']
        duplicate=api(f"/api/v1/nodes/{node['id']}/tasks",'POST',body);assert duplicate['id']==task['id']
        panel.kill();panel.wait(timeout=10);assert sentinel.poll() is None and agent.poll() is None
        panel=subprocess.Popen([str(d/'panel')],env=env,stdout=log,stderr=log);wait_for(lambda: api('/readyz'));wait_for(online)
        assert api('/api/v1/tasks/'+task['id'])['state']=='succeeded'
        agent.terminate();agent.wait(timeout=10);agent=subprocess.Popen([str(d/'agent'),'run','--config',str(d/'agent.json')],stdout=log,stderr=log);wait_for(online)
        api(f"/api/v1/nodes/{node['id']}/revoke",'POST',{})
        wait_for(lambda: agent.poll() is not None,45);assert agent.returncode!=0 and sentinel.poll() is None
        print('Agent connection TLS test passed: enrollment, outbound WSS, real inspection, deduplication, Panel crash/restart, Agent restart, revocation, independent process survival.')
    finally:
        for proc in (agent,panel,sentinel):
            if proc and proc.poll() is None:
                proc.terminate()
                try:proc.wait(timeout=10)
                except subprocess.TimeoutExpired:proc.kill();proc.wait()
        log.close()
