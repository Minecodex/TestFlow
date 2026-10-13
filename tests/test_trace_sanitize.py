"""Check shareable traces without using real account credentials."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location(
    "trace_sanitizer", Path(__file__).resolve().parents[1] / "scripts/sanitize-browser-trace.py"
)
sanitizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sanitizer)


class BrowserTraceSanitizerTest(unittest.TestCase):
    def test_auth_bodies_cookies_and_password_snapshots_are_removed(self):
        secret = "synthetic-secret-for-this-test-only"
        with tempfile.TemporaryDirectory() as directory:
            raw, clean = Path(directory) / "raw.zip", Path(directory) / "clean.zip"
            network = {
                "snapshot": {
                    "request": {
                        "url": "http://localhost/api/v1/auth/login",
                        "headers": [{"name": "Cookie", "value": secret}],
                        "cookies": [{"name": "testflow_session", "value": secret}],
                        "postData": {"_sha1": "private-body", "text": json.dumps({"password": secret})},
                    },
                    "response": {"headers": [{"name": "Set-Cookie", "value": secret}]},
                }
            }
            trace = {"type": "frame-snapshot", "input": {"type": "password", "value": secret}, "execution_id": "kept-id"}
            with zipfile.ZipFile(raw, "w") as archive:
                archive.writestr("session.network", json.dumps(network) + "\n")
                archive.writestr("session.trace", json.dumps(trace) + "\n")
                archive.writestr("resources/private-body", secret)
                archive.writestr("resources/public-screenshot.png", b"public-image-fixture")
            sanitizer.sanitize(raw, clean)
            with zipfile.ZipFile(clean) as archive:
                self.assertNotIn("resources/private-body", archive.namelist())
                self.assertIn("resources/public-screenshot.png", archive.namelist())
                for name in archive.namelist():
                    self.assertNotIn(secret.encode(), archive.read(name))
                self.assertEqual(json.loads(archive.read("session.trace"))["execution_id"], "kept-id")
            self.assertEqual(clean.stat().st_mode & 0o777, 0o600)
            self.assertTrue(raw.exists(), "Keep the private original for local diagnosis")

    def test_credential_endpoint_body_is_omitted_without_omitting_metadata(self):
        value = {"snapshot": {"request": {
            "url": "http://localhost/api/v1/credentials",
            "postData": {"_sha1": "credential-body"}
        }}}
        with tempfile.TemporaryDirectory() as directory:
            raw, clean = Path(directory) / "raw.zip", Path(directory) / "clean.zip"
            with zipfile.ZipFile(raw, "w") as archive:
                archive.writestr("session.network", json.dumps(value) + "\n")
                archive.writestr("resources/credential-body", "synthetic-git-token")
                archive.writestr("metadata.json", json.dumps({"credential_id": "kept-reference", "api_key": "secret"}))
            sanitizer.sanitize(raw, clean)
            with zipfile.ZipFile(clean) as archive:
                self.assertNotIn("resources/credential-body", archive.namelist())
                metadata = json.loads(archive.read("metadata.json"))
                self.assertEqual(metadata["credential_id"], "kept-reference")
                self.assertEqual(metadata["api_key"], "[REDACTED]")

    def test_nested_json_strings_and_api_keys_are_redacted(self):
        result = sanitizer.clean({
            "payload": json.dumps({"password": "synthetic-password", "node_id": "kept-node"}),
            "log": "Synthetic key sk-testfixture_abcdefghijklmnopqrstuvwxyz",
        })
        self.assertEqual(json.loads(result["payload"])["password"], "[REDACTED]")
        self.assertEqual(json.loads(result["payload"])["node_id"], "kept-node")
        self.assertNotIn("sk-testfixture", result["log"])

    def test_private_trace_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "trace.zip"
            with self.assertRaises(ValueError):
                sanitizer.sanitize(file, file)


if __name__ == "__main__":
    unittest.main()
