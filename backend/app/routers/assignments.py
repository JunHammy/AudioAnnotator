from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.dependencies import get_current_user, require_admin
from app.database import get_db
from app.models.models import Assignment, User
from app.schemas.schemas import AssignmentCreate, AssignmentResponse, AssignmentStatusUpdate

router = APIRouter()


@router.get("/", response_model=list[AssignmentResponse])
async def list_assignments(
    audio_file_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Assignment)
    if current_user.role == "annotator":
        query = query.where(Assignment.annotator_id == current_user.id)
    if audio_file_id is not None:
        query = query.where(Assignment.audio_file_id == audio_file_id)
    result = await db.execute(query.order_by(Assignment.created_at.desc()))
    return result.scalars().all()


@router.post("/", response_model=AssignmentResponse, status_code=status.HTTP_201_CREATED)
async def create_assignment(
    body: AssignmentCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    existing = await db.execute(
        select(Assignment).where(
            Assignment.audio_file_id == body.audio_file_id,
            Assignment.annotator_id == body.annotator_id,
            Assignment.task_type == body.task_type,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Assignment already exists")
    assignment = Assignment(**body.model_dump())
    db.add(assignment)
    await db.flush()
    await db.refresh(assignment)
    return assignment


@router.delete("/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_assignment(
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    result = await db.execute(select(Assignment).where(Assignment.id == assignment_id))
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    await db.delete(assignment)


@router.patch("/{assignment_id}/status", response_model=AssignmentResponse)
async def update_assignment_status(
    assignment_id: int,
    body: AssignmentStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Assignment).where(Assignment.id == assignment_id))
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    if current_user.role == "annotator" and assignment.annotator_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if body.status not in ("pending", "in_progress", "completed"):
        raise HTTPException(status_code=400, detail="Invalid status")

    assignment.status = body.status
    if body.status == "completed":
        from datetime import datetime, timezone
        assignment.completed_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(assignment)
    return assignment
