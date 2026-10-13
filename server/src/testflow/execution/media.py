"""Validate media contracts and persist stream/recording products in the asset pool."""
import base64
import io
import struct

from PIL import Image

from testflow.core.contracts import AssetBody
from testflow.features.assets.processing import store_blob, transcode_audio
from testflow.infrastructure.revisions import get_resource, save_resource


async def persist_field(app, field, execution_id, *, capture_text=False, allow_partial=False):
    async with field.persist_lock:
        if field.media_reference: return field.media_reference
        spec = field.spec
        if not spec['stream']:
            if spec['type'] in {'Audio', 'Image'}:
                async with app.state.database.sessions() as db:
                    value = field.value
                    asset = await get_resource(db, 'assets', value['asset_id'], value['asset_version'])
                if asset['data']['type'] != spec['type'] or asset['data']['format'] != spec['format']:
                    raise ValueError('Output media does not match the declared field contract')
            return None
        if not field.eos and not allow_partial: return None
        if spec['type'] == 'Text' and not capture_text: return None
        if not field.chunks and allow_partial: return None
        metadata = {'execution_id': execution_id, 'field': spec['name'], 'truncated': not field.eos}
        extension = '.txt' if spec['type'] == 'Text' else '.wav' if spec['type'] == 'Audio' else '.png'
        value = ''.join(c['data'] for c in field.chunks) if spec['type'] == 'Text' else None
        content = value.encode('utf-8') if value is not None else b''.join(base64.b64decode(c['data'], validate=True) for c in field.chunks)
        if spec['type'] == 'Audio':
            if spec['format'] != 'WAV · 16kHz · Mono': raise ValueError('Unsupported audio stream format')
            if content[:4] == b'RIFF' and content[8:12] == b'WAVE' and content[36:40] == b'data' and content[40:44] == b'\xff' * 4:
                content = content[:4] + struct.pack('<I', len(content)-8) + content[8:40] + struct.pack('<I', len(content)-44) + content[44:]
            content, details = await transcode_audio(content, '.wav')
            metadata.update(details)
        elif spec['type'] == 'Image':
            with Image.open(io.BytesIO(content)) as image:
                image.verify()
            with Image.open(io.BytesIO(content)) as image:
                metadata.update(width=image.width, height=image.height, encoding=image.format)
                extension = '.png' if image.format == 'PNG' else '.jpg' if image.format == 'JPEG' else '.' + image.format.lower()
        root = app.state.settings.data_dir.resolve()
        blob, sha = store_blob(root, content, extension)
        async with app.state.database.sessions() as db, db.begin():
            resource = await save_resource(db, 'assets', AssetBody(name='Captured ' + spec['name'], type=spec['type'], text=value,
                format=spec['format'], blob=blob, sha256=sha, size=len(content), metadata=metadata,
                source=field.origin).model_dump(mode='json'))
        field.media_reference = {'asset_id': resource['id'], 'asset_version': resource['version']}
        return field.media_reference
