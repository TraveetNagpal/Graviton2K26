"""Small HS256 bearer-token auth for this service; secrets remain server-side."""
import base64
import hashlib
import hmac
import json
import time
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.schema import User

bearer = HTTPBearer(auto_error=False)

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def hash_password(password: str) -> str:
    salt = __import__("secrets").token_bytes(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"pbkdf2_sha256${_b64(salt)}${_b64(key)}"

def verify_password(password: str, encoded: str) -> bool:
    try:
        _, salt_text, key_text = encoded.split("$")
        salt = base64.urlsafe_b64decode(salt_text + "=" * (-len(salt_text) % 4))
        key = base64.urlsafe_b64decode(key_text + "=" * (-len(key_text) % 4))
        return hmac.compare_digest(hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000), key)
    except (ValueError, TypeError):
        return False

def create_token(user_id: int) -> str:
    settings = get_settings()
    if not settings.auth_secret:
        raise HTTPException(status_code=503, detail="Authentication is not configured")
    header = _b64(b'{"alg":"HS256","typ":"JWT"}')
    payload = _b64(json.dumps({"sub": str(user_id), "exp": int(time.time()) + settings.auth_token_minutes * 60}, separators=(",", ":")).encode())
    body = f"{header}.{payload}"
    signature = _b64(hmac.new(settings.auth_secret.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{signature}"

def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    settings = get_settings()
    if not settings.auth_secret:
        raise HTTPException(status_code=503, detail="Authentication is not configured")
    if not credentials:
        raise HTTPException(status_code=401, detail="Bearer token required", headers={"WWW-Authenticate": "Bearer"})
    try:
        header, payload, signature = credentials.credentials.split(".")
        body = f"{header}.{payload}"
        expected = _b64(hmac.new(settings.auth_secret.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected): raise ValueError
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if claims["exp"] < time.time(): raise ValueError
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired bearer token", headers={"WWW-Authenticate": "Bearer"}) from exc
    try:
        user = db.scalar(select(User).where(User.id == int(claims["sub"]), User.is_active.is_(True)))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Authentication storage is temporarily unavailable") from exc
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired bearer token", headers={"WWW-Authenticate": "Bearer"})
    return user
