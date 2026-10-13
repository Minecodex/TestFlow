from fastapi import HTTPException


def fail(code: str, message: str, status: int = 422, fields: dict | None = None):
    raise HTTPException(status, {"code": code, "message": message, "fields": fields or {}})
