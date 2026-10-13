import asyncio
import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, SecretStr, Field
from typing import Literal
from sqlalchemy import delete, select

from testflow.core.dependencies import session
from testflow.core.errors import fail
from testflow.core.responses import CredentialResponse, CredentialPageResponse
from testflow.infrastructure.models import Credential, Session
from testflow.infrastructure.revisions import serialize

router = APIRouter(tags=["auth"])
hasher = PasswordHasher()
COOKIE = "testflow_session"


class LoginBody(BaseModel):
    username: str
    password: SecretStr


async def require_admin(request: Request, db=Depends(session, scope="function")):
    token = request.cookies.get(COOKIE, "")
    row = await db.get(Session, hashlib.sha256(token.encode()).hexdigest())
    if not row or row.expires.replace(tzinfo=UTC) < datetime.now(UTC):
        fail("unauthenticated", "Login required", 401)
    return "admin"


@router.post("/auth/login")
async def login(body: LoginBody, request: Request, response: Response, db=Depends(session, scope="function")):
    password_hash = request.app.state.settings.admin_password_hash
    valid = False
    if body.username == "admin" and password_hash:
        try:
            valid = await asyncio.to_thread(hasher.verify, password_hash.get_secret_value(), body.password.get_secret_value())
        except (VerificationError, InvalidHashError):
            pass
    if not valid:
        fail("invalid_login", "Invalid username or password", 401)
    token = secrets.token_urlsafe(48)
    ttl = request.app.state.settings.session_hours * 3600
    db.add(Session(id=hashlib.sha256(token.encode()).hexdigest(), expires=datetime.now(UTC) + timedelta(seconds=ttl)))
    response.set_cookie(COOKIE, token, httponly=True, secure=request.app.state.settings.cookie_secure, samesite="strict", max_age=ttl, path="/")
    return {"username": "admin"}


@router.get("/auth/session")
async def auth_session(_=Depends(require_admin)):
    return {"username": "admin"}


@router.post("/auth/logout")
async def logout(request: Request, response: Response, db=Depends(session, scope="function")):
    key = hashlib.sha256(request.cookies.get(COOKIE, "").encode()).hexdigest()
    await db.execute(delete(Session).where(Session.id == key))
    response.delete_cookie(COOKIE)
    return {"logged_out": True}


class CredentialBody(BaseModel):
    name: str = Field(min_length=1, max_length=256)
    kind: Literal["git", "git-http", "git-ssh", "registry", "evaluation", "module"]
    value: SecretStr


def cipher(request: Request) -> Fernet:
    key = request.app.state.settings.encryption_key
    if not key:
        fail("vault_unconfigured", "Credential encryption key is required", 503)
    return Fernet(key.get_secret_value().encode())


@router.get("/credentials", dependencies=[Depends(require_admin)], response_model=CredentialPageResponse)
async def credentials(db=Depends(session, scope="function")):
    return {"items": [serialize(r) for r in (await db.scalars(select(Credential).order_by(Credential.created.desc()))).all()]}


@router.post("/credentials", dependencies=[Depends(require_admin)], response_model=CredentialResponse)
async def create_credential(body: CredentialBody, request: Request, db=Depends(session, scope="function")):
    row = Credential(name=body.name, kind=body.kind, encrypted=cipher(request).encrypt(body.value.get_secret_value().encode()).decode())
    db.add(row)
    await db.flush()
    return serialize(row)


async def credential_value(db, settings, reference: str | None) -> str | None:
    if not reference:
        return None
    row = await db.get(Credential, reference)
    if not row or not settings.encryption_key:
        fail("credential_unavailable", "Credential reference is unavailable", 422)
    return Fernet(settings.encryption_key.get_secret_value().encode()).decrypt(row.encrypted.encode()).decode()


async def validate_credential(db, reference, kind):
    if not reference: return
    row = await db.get(Credential, reference)
    if not row or (row.kind not in {"git", "git-http", "git-ssh"} if kind == "git" else row.kind != kind):
        fail("invalid_credential", "Select an existing " + kind + " credential reference")
