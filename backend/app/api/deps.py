"""Dependency injection helpers."""
from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.schema import User

# Authentication is intentionally disabled. Every request operates on one
# shared workspace identity so owned records keep a valid users foreign key.
WORKSPACE_EMAIL = "workspace@terramind.local"


def get_workspace_user(db: Session = Depends(get_db)) -> User:
    user = db.scalar(select(User).where(User.email == WORKSPACE_EMAIL))
    if user is not None:
        return user
    user = User(email=WORKSPACE_EMAIL, password_hash="", is_active=True)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Another instance created the workspace row concurrently.
        db.rollback()
        user = db.scalar(select(User).where(User.email == WORKSPACE_EMAIL))
        if user is None:
            raise
        return user
    db.refresh(user)
    return user
