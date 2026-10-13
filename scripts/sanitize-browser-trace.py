"""Export a browser trace after removing auth headers, secret fields, and secret request bodies."""
import argparse
import json
from pathlib import Path
import re
import zipfile

SENSITIVE_HEADERS = {'authorization','proxy-authorization','cookie','set-cookie','x-api-key'}
SENSITIVE_FIELDS = {'password','api_key','access_token','refresh_token','encryption_key','private_key','secret'}
KEY_PATTERN = re.compile(r'\bsk-[A-Za-z0-9_-]{16,}\b')
SECRET_INPUT = re.compile(r'password|api[ _-]?key|凭据正文|密码|密钥', re.I)

def clean(value, secrets=()):
    if isinstance(value, dict):
        if str(value.get('name','')).lower() in SENSITIVE_HEADERS and 'value' in value:
            return {**value,'value':'[REDACTED]'}
        secret_input = value.get('type') == 'password'
        return {k: ([{**clean(cookie,secrets),'value':'[REDACTED]'} for cookie in v] if k.lower() == 'cookies' and isinstance(v,list)
                   else '[REDACTED]' if k.lower() in SENSITIVE_FIELDS or (secret_input and k in {'value','__playwright_value_'}) else clean(v,secrets))
                for k,v in value.items()}
    if isinstance(value,list): return [clean(v,secrets) for v in value]
    if isinstance(value,str):
        # Playwright serializes JSON request bodies as strings.
        if value.startswith(('{','[')):
            try: return json.dumps(clean(json.loads(value),secrets),ensure_ascii=False)
            except (ValueError,TypeError): pass
        for secret in secrets:
            value = value.replace(secret,'[REDACTED]')
        return KEY_PATTERN.sub('[REDACTED]',value)
    return value

def string_values(value):
    if isinstance(value,str):
        if value: yield value
    elif isinstance(value,dict):
        for child in value.values(): yield from string_values(child)
    elif isinstance(value,list):
        for child in value: yield from string_values(child)

def private_values(archive):
    """Follow both Playwright body reference formats before scrubbing logs and DOM snapshots."""
    secrets, omitted = set(), set()
    names = set(archive.namelist())
    for name in names:
        if not name.endswith(('.trace','.network')): continue
        for line in archive.read(name).decode('utf-8').splitlines():
            item = json.loads(line)
            if not isinstance(item,dict): continue
            params = item.get('params',{})
            if item.get('method') in {'fill','type','pressSequentially'} and SECRET_INPUT.search(str(params.get('selector',''))):
                secrets.update(string_values(params.get('value') or params.get('text')))
            request = item.get('snapshot',{}).get('request',{})
            url = request.get('url','')
            if not any(part in url for part in ['/auth/login','/credentials']): continue
            body = request.get('postData',{})
            if not isinstance(body,dict): continue
            reference = body.get('_file') or ('resources/' + body['_sha1'] if body.get('_sha1') else None)
            text = body.get('text','')
            if reference:
                omitted.add(reference)
                if reference in names: text = archive.read(reference).decode('utf-8')
            try: payload = json.loads(text)
            except (ValueError,TypeError): continue
            if isinstance(payload,dict):
                for field in SENSITIVE_FIELDS | ({'value'} if '/credentials' in url else set()):
                    secrets.update(string_values(payload.get(field)))
    return tuple(sorted(secrets,key=len,reverse=True)), omitted

def sanitize(source, destination):
    if source.resolve() == destination.resolve(): raise ValueError('Preserve the original private trace')
    entries = {}
    with zipfile.ZipFile(source) as archive:
        secrets, omitted = private_values(archive)
        for info in archive.infolist():
            data = archive.read(info)
            if info.filename.endswith(('.trace','.network','.json')):
                lines = []
                content=data.decode('utf-8')
                for line in [content] if info.filename.endswith('.json') else content.splitlines():
                    item = json.loads(line)
                    request = item.get('snapshot',{}).get('request',{}) if isinstance(item,dict) else {}
                    if any(part in request.get('url','') for part in ['/auth/login','/credentials']):
                        body = request.get('postData',{})
                        if isinstance(body,dict) and body.get('_sha1'): omitted.add('resources/'+body['_sha1'])
                        if isinstance(body,dict) and body.get('_file'): omitted.add(body['_file'])
                        request['postData'] = {'text':'[REDACTED secret endpoint body]'}
                    lines.append(json.dumps(clean(item,secrets),ensure_ascii=False))
                data = ('\n'.join(lines)+'\n').encode()
            if info.filename.startswith('resources/'):
                # Request JSON can also live in a SHA-1 resource without a .json suffix.
                # Inline model credentials must not survive in that detached request body.
                try:
                    decoded = data.decode('utf-8')
                    value = json.loads(decoded)
                    data = json.dumps(clean(value,secrets), ensure_ascii=False).encode()
                except (UnicodeDecodeError, ValueError, TypeError):
                    try:
                        data = clean(data.decode('utf-8'),secrets).encode()
                    except UnicodeDecodeError:
                        pass
            entries[info.filename] = data
    destination.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(destination,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        for name,data in entries.items():
            if name not in omitted: archive.writestr(name,data)
    destination.chmod(0o600)

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    parser.add_argument('destination',type=Path)
    args=parser.parse_args()
    sanitize(args.source,args.destination)
    print('Sanitized trace written:',args.destination)
