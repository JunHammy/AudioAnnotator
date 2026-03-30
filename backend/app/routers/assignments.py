from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select, update

from app.auth.dependencies import get_current_user, require_admin
from app.database import get_db
from app.models.models import Assignment, AudioFile, User
from app.schemas.schemas import (
    AssignmentBatchCreate,
    AssignmentCreate,
    AssignmentMetaUpdate,
    AssignmentResponse,
    AssignmentStatusUpdate,
)
from app.services.audit import write_audit_log
from app.services.notifications import create_notification
from app.services.sse import sse_manager

router = APIRouter()


@router.get("", response_model=list[AssignmentResponse])
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


@router.post("", response_model=AssignmentResponse, status_code=status.HTTP_201_CREATED)
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
    await write_audit_log(db, _admin.id, "assign_task", "assignment", assignment.id,
                          {"audio_file_id": body.audio_file_id, "annotator_id": body.annotator_id,
                           "task_type": body.task_type})
    af_name = (await db.execute(
        select(AudioFile.filename).where(AudioFile.id == body.audio_file_id)
    )).scalar_one_or_none() or f"file #{body.audio_file_id}"
    await create_notification(
        db,
        user_id=body.annotator_id,
        notif_type="assignment",
        message=f"New task assigned: {body.task_type} on {af_name}",
        audio_file_id=body.audio_file_id,
    )
    await sse_manager.broadcast_user(body.annotator_id, {
        "type": "assignment_created",
        "data": {"audio_file_id": body.audio_file_id, "task_type": body.task_type},
    })
    return assignment


@router.post("/batch", response_model=list[AssignmentResponse], status_code=status.HTTP_201_CREATED)
async def create_assignment_batch(
    body: AssignmentBatchCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """
    Create multiple assignments for one annotator+file in a validated combination.
    Enforces: emotion requires speaker to be locked first.
    Silently skips task types that are already assigned.
    """
    if "emotion" in body.task_types:
        af = (await db.execute(
            select(AudioFile).where(AudioFile.id == body.audio_file_id)
        )).scalar_one_or_none()
        if not af:
            raise HTTPException(status_code=404, detail="Audio file not found")
        if not af.collaborative_locked_speaker:
            raise HTTPException(
                status_code=400,
                detail="Speaker annotation must be finalized (locked) before assigning emotion tasks.",
            )

    created = []
    for task_type in body.task_types:
        existing = (await db.execute(
            select(Assignment).where(
                Assignment.audio_file_id == body.audio_file_id,
                Assignment.annotator_id == body.annotator_id,
                Assignment.task_type == task_type,
            )
        )).scalar_one_or_none()
        if existing:
            continue  # skip already-assigned silently

        a = Assignment(
            audio_file_id=body.audio_file_id,
            annotator_id=body.annotator_id,
            task_type=task_type,
            priority=body.priority,
            due_date=body.due_date,
        )
        db.add(a)
        created.append(a)

    if created:
        await db.flush()
        for a in created:
            await db.refresh(a)
        await write_audit_log(db, _admin.id, "assign_task_batch", "audio_file", body.audio_file_id,
                              {"annotator_id": body.annotator_id, "task_types": body.task_types})

        # Notify the annotator — one notification summarising all new task types
        af_name = (await db.execute(
            select(AudioFile.filename).where(AudioFile.id == body.audio_file_id)
        )).scalar_one_or_none() or f"file #{body.audio_file_id}"
        task_label = " + ".join(sorted({a.task_type for a in created}))
        await create_notification(
            db,
            user_id=body.annotator_id,
            notif_type="assignment",
            message=f"New task assigned: {task_label} on {af_name}",
            audio_file_id=body.audio_file_id,
        )
        await sse_manager.broadcast_user(body.annotator_id, {
            "type": "assignment_created",
            "data": {
                "audio_file_id": body.audio_file_id,
                "task_types": [a.task_type for a in created],
            },
        })

    return created


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

    assignment.status = body.status
    if body.status == "completed":
        assignment.completed_at = datetime.now(timezone.utc)
        await db.flush()
        await write_audit_log(db, current_user.id, "complete_task", "assignment", assignment.id,
                              {"audio_file_id": assignment.audio_file_id,
                               "task_type": assignment.task_type})

        # Auto-lock when ALL annotators for that task type complete.
        # Uses COUNT of still-pending assignments (atomic read) + conditional
        # UPDATE (only sets lock if not already set) to avoid a race condition
        # where two simultaneous completions both read stale state.
        if assignment.task_type in ("speaker", "gender", "transcription", "emotion"):
            lock_col = f"collaborative_locked_{assignment.task_type}"
            pending = (await db.execute(
                select(func.count(Assignment.id))
                .where(Assignment.audio_file_id == assignment.audio_file_id)
                .where(Assignment.task_type == assignment.task_type)
                .where(Assignment.status != "completed")
            )).scalar_one()

            if pending == 0:
                await db.execute(
                    update(AudioFile)
                    .where(AudioFile.id == assignment.audio_file_id)
                    .where(getattr(AudioFile, lock_col) == False)  # noqa: E712
                    .values(**{lock_col: True})
                    .execution_options(synchronize_session=False)
                )


    await db.flush()
    await db.refresh(assignment)
    return assignment


@router.patch("/{assignment_id}/meta", response_model=AssignmentResponse)
async def update_assignment_meta(
    assignment_id: int,
    body: AssignmentMetaUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    result = await db.execute(select(Assignment).where(Assignment.id == assignment_id))
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if body.priority is not None:
        assignment.priority = body.priority
    if body.due_date is not None:
        assignment.due_date = body.due_date
    await db.flush()
    await db.refresh(assignment)
    return assignment
