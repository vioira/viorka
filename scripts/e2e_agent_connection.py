#!/usr/bin/env python3
"""Local two-process TLS fault test. Requires sibling viorka-agent, Go and OpenSSL.
No production data, inbound Agent listener or proxy engine is used.
"""
import argparse, hashlib, http.cookiejar, json, os, pathlib, secrets, socket, ssl, subprocess, tempfile, time, urllib.request, urllib.error
root = pathlib.Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--agent', type=pathlib.Path, default=root.parent/'viorka-agent')
p.add_argument('--panel-binary', type=pathlib.Path)
p.add_argument('--agent-binary', type=pathlib.Path)
args = p.parse_args()
for binary in (args.panel_binary, args.agent_binary):
    if binary is not None and (not binary.is_absolute() or not binary.is_file() or not os.access(binary, os.X_OK)):
        p.error('prebuilt binaries must be existing absolute executable paths')
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
    panel_binary = args.panel_binary or d/'panel'
    agent_binary = args.agent_binary or d/'agent'
    if args.panel_binary is None:
        subprocess.run(['go','build','-o',str(panel_binary),'./cmd/server'],cwd=root,env=env,check=True)
    if args.agent_binary is None:
        subprocess.run(['go','build','-o',str(agent_binary),'./cmd/viorka-agent'],cwd=args.agent,env=env,check=True)
    print('Binary SHA256:', 'Panel='+hashlib.sha256(panel_binary.read_bytes()).hexdigest(), 'Agent='+hashlib.sha256(agent_binary.read_bytes()).hexdigest(), flush=True)
    env['VIORKA_TELEMETRY_V3'] = 'true'
    subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(d/'key.pem'),'-out',str(d/'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    with socket.socket() as s:s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
    origin=f'https://127.0.0.1:{port}'; password=secrets.token_urlsafe(24); (d/'password').write_text(password);(d/'password').chmod(0o600)
    env.update(VIORKA_LISTEN=f'127.0.0.1:{port}',VIORKA_ORIGIN=origin,VIORKA_DATABASE=str(d/'panel.db'),VIORKA_ADMIN_USERNAME='admin',VIORKA_ADMIN_PASSWORD_FILE=str(d/'password'),VIORKA_TLS_CERT=str(d/'cert.pem'),VIORKA_TLS_KEY=str(d/'key.pem'))
    config={'panel_url':origin,'node_name':'NAT outbound test','state_dir':str(d/'agent-state'),'log_level':'warn','ca_file':str(d/'cert.pem') }
    config['telemetry_v3'] = True
    (d/'agent.json').write_text(json.dumps(config)); (d/'agent.json').chmod(0o600)
    context=ssl.create_default_context(cafile=str(d/'cert.pem'));cookies=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPSHandler(context=context),urllib.request.HTTPCookieProcessor(cookies));csrf=''
    def api(path,method='GET',data=None):
        req=urllib.request.Request(origin+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json','Origin':origin,'X-CSRF-Token':csrf})
        with client.open(req,timeout=3) as res:return json.load(res) if res.status!=204 else None
    log=open(d/'process.log','w');panel=agent=sentinel=None
    try:
        panel=subprocess.Popen([str(panel_binary)],env=env,stdout=log,stderr=log)
        wait_for(lambda: api('/readyz'));session=api('/api/v1/auth/login','POST',{'username':'admin','password':password});csrf=session['csrf_token']
        created=api('/api/v1/nodes','POST',{'name':'NAT outbound test','kind':'nat'});token=created['token']
        pending=api('/api/v1/nodes')['items'];assert len(pending)==1 and pending[0]['id']==created['id'] and pending[0]['state']=='pending'
        subprocess.run([str(agent_binary),'enroll','--config',str(d/'agent.json'),'--token-stdin'],input=token,text=True,stdout=log,stderr=log,timeout=20,check=True)
        agent=subprocess.Popen([str(agent_binary),'run','--config',str(d/'agent.json')],stdout=log,stderr=log)
        # Independent existing process stands in for unrelated node workloads.
        sentinel=subprocess.Popen(['sleep','600'])
        def online():
            items=api('/api/v1/nodes')['items'];return items[0] if items and items[0]['state']=='online' else None
        node=wait_for(online)
        assert node['id']==created['id'] and len(api('/api/v1/nodes')['items'])==1
        def monitoring():
            snapshot=api(f"/api/v1/nodes/{node['id']}/metrics")
            return snapshot if (snapshot.get('telemetry') or {}).get('fast') else None
        snapshot=wait_for(monitoring,90)
        assert not snapshot['telemetry']['fast_stale']
        run_id=snapshot['telemetry']['run_id']
        assert run_id and snapshot['telemetry_control']['mode']=='http'
        fast=snapshot['telemetry']['fast']
        if os.uname().sysname=='Linux':
            assert int(fast['ram_total'])>0
        else:
            assert fast['errors']==['unsupported_platform']
        body={'operation':'node.inspect','idempotency_key':'restart-safe'}
        task=api(f"/api/v1/nodes/{node['id']}/tasks",'POST',body)
        result=wait_for(lambda: (v if (v:=api('/api/v1/tasks/'+task['id']))['state']=='succeeded' else None))
        assert result['result']['inspection']['hostname']
        page=api('/api/v1/tasks?state=succeeded&limit=1')
        assert page['items'][0]['id']==task['id'] and page['next_cursor']==''
        assert page['items'][0]['node_name']=='NAT outbound test'
        assert page['items'][0]['created_at'] and page['items'][0]['updated_at']
        assert page['items'][0]['attempt']==1 and page['items'][0]['max_attempts']==3
        summary=api('/api/v1/tasks/summary')
        assert summary['total']==1 and summary['succeeded']==1 and summary['success_rate']==100 and summary['active']==0
        duplicate=api(f"/api/v1/nodes/{node['id']}/tasks",'POST',body);assert duplicate['id']==task['id']
        panel.kill();panel.wait(timeout=10);assert sentinel.poll() is None and agent.poll() is None
        panel=subprocess.Popen([str(panel_binary)],env=env,stdout=log,stderr=log);wait_for(lambda: api('/readyz'));wait_for(online)
        assert api('/api/v1/tasks/'+task['id'])['state']=='succeeded'
        assert wait_for(monitoring,90)['telemetry']['run_id']==run_id
        agent.terminate();agent.wait(timeout=10);agent=subprocess.Popen([str(agent_binary),'run','--config',str(d/'agent.json')],stdout=log,stderr=log);wait_for(online)
        wait_for(lambda: (v if (v:=monitoring()) and v['telemetry']['run_id']!=run_id else None),90)
        api(f"/api/v1/nodes/{node['id']}/revoke",'POST',{})
        wait_for(lambda: agent.poll() is not None,45);assert agent.returncode!=0 and sentinel.poll() is None
        print('Metrics mode: v3')
        print('Agent connection TLS test passed: enrollment, outbound WSS, negotiated metrics, real inspection, task center list/summary, deduplication, Panel crash/restart, Agent restart, revocation, independent process survival.')
    finally:
        for proc in (agent,panel,sentinel):
            if proc and proc.poll() is None:
                proc.terminate()
                try:proc.wait(timeout=10)
                except subprocess.TimeoutExpired:proc.kill();proc.wait()
        log.close()
