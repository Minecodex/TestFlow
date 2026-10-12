"""Credential material stays in the vault/resource response, never execution evidence."""
import json


def credential_strings(value):
    result = {value}
    try:
        def visit(item):
            if isinstance(item, str) and len(item) >= 4: result.add(item)
            elif isinstance(item, dict):
                for v in item.values(): visit(v)
            elif isinstance(item, list):
                for v in item: visit(v)
        visit(json.loads(value))
    except (ValueError, TypeError): pass
    return result


def redact(value, secrets):
    if isinstance(value, str):
        for secret in sorted(secrets, key=len, reverse=True):
            if secret: value = value.replace(secret, '[redacted]')
        return value
    if isinstance(value, dict): return {k: redact(v, secrets) for k, v in value.items()}
    if isinstance(value, list): return [redact(v, secrets) for v in value]
    return value


def credential_refs(schema, values, root=None, seen=None):
    root = root or schema
    seen = set() if seen is None else seen
    marker = (id(schema), id(values))
    if marker in seen: return set()
    seen.add(marker)
    if '$ref' in schema:
        reference = schema['$ref']
        target = root
        if reference.startswith('#/'):
            from urllib.parse import unquote
            for part in unquote(reference[2:]).split('/'):
                target = target[part.replace('~1', '/').replace('~0', '~')]
        elif reference != '#':
            def anchor(value):
                if isinstance(value, dict):
                    if value.get('$anchor') == reference[1:]: return value
                    for child in value.values():
                        found = anchor(child)
                        if found is not None: return found
                elif isinstance(value, list):
                    for child in value:
                        found = anchor(child)
                        if found is not None: return found
            target = anchor(root)
            if target is None: raise ValueError('Unknown local Schema anchor')
        return credential_refs(target, values, root, seen)
    if schema.get('x-testflow-credential') and isinstance(values, str): return {values} if values else set()
    result = set()
    if isinstance(values, dict):
        for key, child in schema.get('properties', {}).items():
            if key in values: result |= credential_refs(child, values[key], root, seen)
    elif isinstance(values, list) and isinstance(schema.get('items'), dict):
        for value in values: result |= credential_refs(schema['items'], value, root, seen)
    return result
