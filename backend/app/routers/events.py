import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.jwt import decode_token
from app.database import get_db
from app.models.models import User
from app.services.sse import sse_manager

router = APIRouter()


async def _user_from_query_token(token: str, db: AsyncSession) -> User:
    """Authenticate via ?token= query param (used by EventSource which can't send headers)."""
    try:
        payload = decode_token(token)
        user_id = int(payload.get("sub"))
    except (JWTError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token")
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


@router.get("/events/{file_id}")
async def sse_events(
    file_id: int,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Server-Sent Events stream for a single audio file.
    Clients receive real-time segment create/update/delete events from other annotators.
    Authentication is via ?token= because the browser EventSource API cannot send headers.
    """
    await _user_from_query_token(token, db)

    async def stream():
        q = sse_manager.subscribe(file_id)
        try:
            # Initial handshake so the client knows the connection is live
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # Keepalive comment — prevents proxies and browsers from closing the connection
                    yield ": keepalive\n\n"
        finally:
            sse_manager.unsubscribe(file_id, q)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/events/user")
async def sse_user_events(
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Per-user SSE stream for app-wide events:
    notifications, new assignments, admin responses.
    """
    user = await _user_from_query_token(token, db)

    async def stream():
        q = sse_manager.subscribe_user(user.id)
        try:
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            sse_manager.unsubscribe_user(user.id, q)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
