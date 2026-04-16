from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.dependencies import require_admin
from app.auth.jwt import hash_password
from app.database import get_db
from app.models.models import User
from app.schemas.schemas import UserCreate, UserResponse, UserUpdate
from app.services.audit import write_audit_log

router = APIRouter()


@router.get("", response_model=list[UserResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already taken")

    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    await write_audit_log(db, _admin.id, "create_user", "user", user.id,
                          {"username": user.username, "role": user.role})
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if user_id == _admin.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await write_audit_log(db, _admin.id, "delete_user", "user", user.id,
                          {"username": user.username, "role": user.role})
    await db.delete(user)
    await db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    changes: dict = {}
    if body.username is not None and body.username != user.username:
        conflict = await db.execute(select(User).where(User.username == body.username))
        if conflict.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Username already taken.")
        changes["old_username"] = user.username
        changes["new_username"] = body.username
        user.username = body.username
    if body.is_active is not None and body.is_active != user.is_active:
        changes["is_active"] = body.is_active
        user.is_active = body.is_active
    if body.role is not None and body.role != user.role:
        changes["role"] = body.role
        user.role = body.role
    if body.password is not None:
        changes["password_reset"] = True
        user.password_hash = hash_password(body.password)

    await db.flush()
    await db.refresh(user)
    if changes:
        await write_audit_log(db, _admin.id, "update_user", "user", user.id,
                              {"username": user.username, **changes})
    return user
