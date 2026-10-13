import importlib.util
import json
from pathlib import Path
import zipfile

def test_browser_trace_removes_credentials_and_retains_business_evidence(tmp_path):
    script=Path(__file__).resolve().parents[2]/'scripts/sanitize-browser-trace.py'
    spec=importlib.util.spec_from_file_location('trace_redaction',script)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    private=tmp_path/'trace.private.zip';public=tmp_path/'trace.zip'
    record={'snapshot':{'request':{'url':'http://test/api/v1/credentials','headers':[
        {'name':'Cookie','value':'testflow_session=private-session'},
        {'name':'Authorization','value':'Bearer private-token'}], 'cookies':[{'name':'testflow_session','value':'private-jar-cookie'}],
        'postData':{'_sha1':'secret-body','text':json.dumps({'password':'private-password'})}},
        'response':{'headers':[{'name':'Set-Cookie','value':'private-cookie'}]}},
        'material':{'credential_id':'public-reference-id','case':'Synthetic test input'}}
    with zipfile.ZipFile(private,'w') as archive:
        archive.writestr('trace.network',json.dumps(record)+'\n')
        archive.writestr('trace.trace',json.dumps({'attributes':{'type':'password','value':'private-password'}})+'\n')
        archive.writestr('resources/secret-body','secret resource')
        archive.writestr('metadata.json',json.dumps({'api_key':'sk-synthetic-testing-key-0123456789'},indent=2))
    module.sanitize(private,public)
    with zipfile.ZipFile(public) as archive:
        assert 'resources/secret-body' not in archive.namelist()
        text=''.join(archive.read(name).decode() for name in archive.namelist())
        for secret in ['private-session','private-token','private-cookie','private-password','private-jar-cookie','sk-synthetic-testing-key-0123456789']: assert secret not in text
        assert 'public-reference-id' in text and 'Synthetic test input' in text
    assert public.stat().st_mode & 0o777 == 0o600
