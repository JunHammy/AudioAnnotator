"""
In-app notification endpoints (annotator-facing).
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.models import Notification, User

router = APIRouter()

_MAX_FETCH = 60  # return the most recent N notifications


class NotificationOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    type: str
    message: str
    audio_file_id: int | None
    read: bool
    created_at: datetime


@router.get("/", response_model=list[NotificationOut])
async def list_notifications(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return up to 60 most recent notifications for the current user, unread first."""
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.read.asc(), Notification.created_at.desc())
        .limit(_MAX_FETCH)
    )
    return result.scalars().all()


@router.get("/unread-count")
async def unread_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lightweight endpoint for polling unread count without fetching full messages."""
    from sqlalchemy import func
    count = (await db.execute(
        select(func.count(Notification.id))
        .where(Notification.user_id == current_user.id)
        .where(Notification.read == False)  # noqa: E712
    )).scalar_one()
    return {"count": count}


@router.patch("/mark-all-read")
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await db.execute(
        update(Notification)
        .where(Notification.user_id == current_user.id)
        .where(Notification.read == False)  # noqa: E712
        .values(read=True)
    )
    await db.flush()
    return {"ok": True}


@router.patch("/{notif_id}/read")
async def mark_one_read(
    notif_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notif = (await db.execute(
        select(Notification)
        .where(Notification.id == notif_id)
        .where(Notification.user_id == current_user.id)
    )).scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.read = True
    await db.flush()
    return {"ok": True}
