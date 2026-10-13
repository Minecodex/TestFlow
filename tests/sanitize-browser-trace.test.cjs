const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

test('public browser traces remove arbitrary credential text and both detached body formats', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'testflow-trace-'));
  const source = path.join(directory, 'private.zip'), output = path.join(directory, 'trace.zip');
  try {
    execFileSync('python3', ['-c', `
import json,sys,zipfile
credential='fixture-business-key'
password='test-password-987'
rows=[
 {'type':'before','method':'fill','params':{'selector':"getByRole('textbox', { name: '凭据正文（加密保存）' })",'value':credential}},
 {'type':'log','message':'filled '+credential},
 {'type':'frame-snapshot','snapshot':{'html':['INPUT',{'type':'password','__playwright_value_':credential}]}},
 {'type':'log','message':'filled '+password},
 {'type':'frame-snapshot','snapshot':{'html':['INPUT',{'type':'text','value':'visible-input'}]}}
]
network=[
 {'snapshot':{'request':{'url':'http://localhost/api/v1/credentials','method':'POST','postData':{'text':'','_file':'resources/credential.json'}}}},
 {'snapshot':{'request':{'url':'http://localhost/api/v1/auth/login','method':'POST','postData':{'_sha1':'login-body'},'headers':[{'name':'Cookie','value':'session=private-cookie'}]}}},
 {'snapshot':{'request':{'url':'http://localhost/api/v1/assets','method':'POST','postData':{'text':'{"value":"ordinary-text"}'}}}}
]
with zipfile.ZipFile(sys.argv[1],'w') as archive:
 archive.writestr('trace.trace','\\n'.join(json.dumps(row) for row in rows))
 archive.writestr('trace.network','\\n'.join(json.dumps(row) for row in network))
 archive.writestr('resources/credential.json',json.dumps({'name':'Business credential','kind':'module','value':credential}))
 archive.writestr('resources/login-body',json.dumps({'username':'admin','password':password}))
 archive.writestr('resources/image.png',b'\\x89PNG\\x00fixture')
`, source]);
    execFileSync('python3', [path.resolve('scripts/sanitize-browser-trace.py'), source, output]);
    execFileSync('python3', ['-c', `
import json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
 names=archive.namelist()
 assert 'resources/credential.json' not in names and 'resources/login-body' not in names
 text=b'\\n'.join(archive.read(name) for name in names if name!='resources/image.png')
 assert not any(secret in text for secret in [b'fixture-business-key',b'test-password-987',b'private-cookie'])
 assert b'visible-input' in text and b'ordinary-text' in text
 assert archive.read('resources/image.png')==b'\\x89PNG\\x00fixture'
 for name in ['trace.trace','trace.network']:
  for line in archive.read(name).decode().splitlines(): json.loads(line)
`, output]);
  } finally {
    fs.rmSync(directory, {recursive:true,force:true});
  }
});
