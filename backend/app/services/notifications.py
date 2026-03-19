"""
Lightweight helper for creating in-app notifications.
Callers are responsible for flushing/committing the session.
"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Notification


async def create_notification(
    db: AsyncSession,
    user_id: int,
    notif_type: str,
    message: str,
    audio_file_id: int | None = None,
) -> None:
    """Queue a notification row — caller must flush/commit the enclosing transaction."""
    db.add(Notification(
        user_id=user_id,
        type=notif_type,
        message=message,
        audio_file_id=audio_file_id,
    ))
