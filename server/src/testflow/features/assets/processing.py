"""Media validation shared by uploads and portable asset packages."""
import asyncio
import hashlib
import io
import tempfile
import wave
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from testflow.core.errors import fail

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".ogg", ".webm", ".m4a", ".flac"}


def image_metadata(content):
    try:
        with Image.open(io.BytesIO(content)) as image:
            image.verify()
        with Image.open(io.BytesIO(content)) as image:
            return {"width": image.width, "height": image.height, "encoding": image.format}
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        fail("invalid_image", "Invalid image")


def audio_metadata(content):
    try:
        with wave.open(io.BytesIO(content)) as audio:
            rate, channels, width, frames = audio.getframerate(), audio.getnchannels(), audio.getsampwidth(), audio.getnframes()
            if (rate, channels, width, audio.getcomptype()) != (16000, 1, 2, "NONE") or not frames:
                fail("invalid_audio", "Portable audio must use WAV, 16kHz, mono PCM16")
            if len(audio.readframes(frames)) != frames * channels * width:
                fail("invalid_audio", "Audio data is truncated")
            return {"sample_rate": rate, "channels": channels, "encoding": "pcm_s16le", "frames": frames, "duration": frames / rate}
    except (wave.Error, EOFError):
        fail("invalid_audio", "Invalid WAV audio")


async def transcode_audio(content, extension):
    with tempfile.TemporaryDirectory(prefix="testflow-audio-") as directory:
        source, target = Path(directory) / ("input" + extension), Path(directory) / "output.wav"
        source.write_bytes(content)
        process = await asyncio.create_subprocess_exec("ffmpeg", "-nostdin", "-v", "error", "-i", str(source), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(target), stderr=asyncio.subprocess.PIPE)
        try:
            async with asyncio.timeout(60):
                await process.communicate()
        except BaseException:
            if process.returncode is None:
                process.kill()
            await process.wait()
            raise
        if process.returncode:
            fail("invalid_audio", "Audio cannot be decoded")
        value = target.read_bytes()
        return value, audio_metadata(value)


def store_blob(root: Path, content: bytes, extension: str):
    identity = hashlib.sha256(content).hexdigest()
    relative = "assets/" + identity + extension
    path = root / relative
    if not path.exists():
        path.write_bytes(content)
    return relative, identity


async def prepare_upload(root, content, filename, source, content_type=""):
    extension = Path(filename).suffix.lower()
    data = {"name": filename, "source": source, "size": len(content)}
    if extension in {".txt", ".md", ".json"} or content_type.startswith("text/"):
        try:
            value = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            fail("invalid_text", "Text must use UTF-8")
        # Canonical bytes and text must agree, including uploads containing a BOM.
        content = value.encode("utf-8")
        extension = ".txt"
        data.update(type="Text", text=value, format="UTF-8")
    elif extension in IMAGE_EXTENSIONS:
        data.update(type="Image", format="Image/*", metadata=image_metadata(content))
    elif extension in AUDIO_EXTENSIONS:
        original, _ = store_blob(root, content, extension)
        content, metadata = await transcode_audio(content, extension)
        data.update(type="Audio", format="WAV · 16kHz · Mono", metadata=metadata, original_blob=original)
        extension = ".wav"
    else:
        fail("unsupported_media", "Supported uploads: UTF-8 text, images and audio")
    blob, sha = store_blob(root, content, extension)
    return {**data, "blob": blob, "sha256": sha, "size": len(content)}
