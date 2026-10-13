"""Create a private development config; never overwrite an existing one."""
from pathlib import Path
from argon2 import PasswordHasher
from cryptography.fernet import Fernet

root = Path(__file__).resolve().parents[1]
path = root / '.env'
if path.exists():
    raise SystemExit('Existing .env preserved')
password = '123456'
key = Fernet.generate_key().decode()
values = {
    'TESTFLOW_ENVIRONMENT': 'development',
    'TESTFLOW_DATABASE_URL': 'postgresql+asyncpg://testflow:testflow-development-only@127.0.0.1:15432/testflow',
    'TESTFLOW_ADMIN_PASSWORD_HASH': PasswordHasher().hash(password),
    'TESTFLOW_ENCRYPTION_KEY': key,
    'TESTFLOW_DATA_DIR': '.data',
    'TESTFLOW_PUBLIC_URL': 'http://127.0.0.1:5173',
    'TESTFLOW_ALLOW_LOCAL_IMAGES': 'true',
}
path.write_text('\n'.join(f'{k}={v}' for k,v in values.items())+'\n');path.chmod(0o600)
(root/'.data').mkdir(exist_ok=True)
initial = root/'.data/admin-initial-password'; initial.write_text(password+'\n');initial.chmod(0o600)
print('Created private .env and .data/admin-initial-password (admin login)')
