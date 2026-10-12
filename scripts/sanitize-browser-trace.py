"""Export a browser trace after removing auth headers, secret fields, and secret request bodies."""
import argparse
import json
from pathlib import Path
import re
import zipfile

SENSITIVE_HEADERS = {'authorization','proxy-authorization','cookie','set-cookie','x-api-key'}
SENSITIVE_FIELDS = {'password','api_key','access_token','refresh_token','encryption_key','private_key','secret'}
KEY_PATTERN = re.compile(r'\bsk-[A-Za-z0-9_-]{16,}\b')

def clean(value):
    if isinstance(value, dict):
        if str(value.get('name','')).lower() in SENSITIVE_HEADERS and 'value' in value:
            return {**value,'value':'[REDACTED]'}
        secret_input = value.get('type') == 'password'
        return {k: ([{**clean(cookie),'value':'[REDACTED]'} for cookie in v] if k.lower() == 'cookies' and isinstance(v,list)
                   else '[REDACTED]' if k.lower() in SENSITIVE_FIELDS or (secret_input and k == 'value') else clean(v))
                for k,v in value.items()}
    if isinstance(value,list): return [clean(v) for v in value]
    if isinstance(value,str):
        # Playwright serializes JSON request bodies as strings.
        if value.startswith(('{','[')):
            try: return json.dumps(clean(json.loads(value)),ensure_ascii=False)
            except (ValueError,TypeError): pass
        return KEY_PATTERN.sub('[REDACTED]',value)
    return value

def sanitize(source, destination):
    if source.resolve() == destination.resolve(): raise ValueError('Preserve the original private trace')
    omitted = set()
    entries = {}
    with zipfile.ZipFile(source) as archive:
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
                        request['postData'] = {'text':'[REDACTED secret endpoint body]'}
                    lines.append(json.dumps(clean(item),ensure_ascii=False))
                data = ('\n'.join(lines)+'\n').encode()
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
