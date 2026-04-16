from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.models import AuditLog


async def write_audit_log(
    db: AsyncSession,
    user_id: int,
    action: str,
    resource_type: Optional[str] = None,
    resource_id: Optional[int] = None,
    details: Optional[dict] = None,
) -> None:
    db.add(AuditLog(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details,
    ))
