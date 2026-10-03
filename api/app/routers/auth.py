import logging

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import ratelimit
from app.db import get_session
from app.deps import get_current_user
from app.models import User
from app.ratelimit import RateLimit
from app.schemas import LoginIn, RefreshIn, SignupIn, TokenOut, UserOut
from app.security import (
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger("queueup.auth")


def _tokens(user: User) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(user.id, user.is_admin),
        refresh_token=create_refresh_token(user.id),
        user=UserOut.model_validate(user),
    )


@router.post("/signup", response_model=TokenOut, status_code=201,
             dependencies=[Depends(RateLimit("signup", 20, 3600))])
async def signup(body: SignupIn, session: AsyncSession = Depends(get_session)) -> TokenOut:
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        display_name=body.display_name.strip(),
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, {"error": "email_taken"}) from None
    await session.refresh(user)
    log.info("signup", extra={"ctx": {"user_id": str(user.id)}})
    return _tokens(user)


@router.post("/login", response_model=TokenOut,
             dependencies=[Depends(RateLimit("login", 20, 300))])
async def login(body: LoginIn, request: Request, session: AsyncSession = Depends(get_session)) -> TokenOut:
    # Per-account limit too, so a botnet rotating IPs still can't brute-force one user.
    await ratelimit.hit(f"login:email:{body.email.lower()}", 10, 300)
    user = await session.scalar(sa.select(User).where(User.email == body.email))
    if not verify_password(user.password_hash if user else None, body.password) or user is None:
        log.info("login failed", extra={"ctx": {"ip": ratelimit.client_ip(request)}})
        # Same message whether the email exists or not.
        raise HTTPException(401, {"error": "invalid_credentials"})
    if user.is_suspended:
        raise HTTPException(403, {"error": "account_suspended"})
    return _tokens(user)


@router.post("/refresh", response_model=TokenOut)
async def refresh(body: RefreshIn, session: AsyncSession = Depends(get_session)) -> TokenOut:
    try:
        user_id = decode_token(body.refresh_token, "refresh")
    except TokenError:
        raise HTTPException(401, {"error": "invalid_token"}) from None
    user = await session.get(User, user_id)
    if user is None or user.is_suspended:
        raise HTTPException(401, {"error": "invalid_token"})
    return _tokens(user)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> User:
    return user
