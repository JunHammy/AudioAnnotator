import asyncio
import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.models import User
from app.services.sse import sse_manager

router = APIRouter()


@router.get("/events/user")
async def sse_user_events(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Per-user SSE stream for app-wide events:
    notifications, new assignments, admin responses.
    Authenticated via the standard Authorization: Bearer header.
    """
    async def stream():
        q = sse_manager.subscribe_user(current_user.id)
        try:
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            sse_manager.unsubscribe_user(current_user.id, q)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/events/{file_id}")
async def sse_events(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Server-Sent Events stream for a single audio file.
    Authenticated via the standard Authorization: Bearer header.
    """
    async def stream():
        q = sse_manager.subscribe(file_id)
        try:
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
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
