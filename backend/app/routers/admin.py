import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, distinct, select, case

from app.auth.dependencies import require_admin
from app.database import get_db
from app.models.models import AppConfig, Assignment, AudioFile, AuditLog, Dataset, SpeakerSegment, User
from app.schemas.schemas import BracketWordsUpdate

# Legacy file path — used once for auto-migration if the DB row doesn't exist yet
_LEGACY_BRACKET_WORDS_PATH = (
    Path(__file__).parent.parent.parent.parent / "config" / "bracket_words.json"
)
_BRACKET_WORDS_KEY = "bracket_words"

router = APIRouter()


# ─── Bracket Words ────────────────────────────────────────────────────────────

async def _get_bracket_words_data(db: AsyncSession) -> dict:
    """Load bracket words from DB. Auto-migrates from legacy file on first call."""
    row = (await db.execute(
        select(AppConfig).where(AppConfig.key == _BRACKET_WORDS_KEY)
    )).scalar_one_or_none()

    if row is None:
        # First time — seed from legacy file if it exists, otherwise empty
        if _LEGACY_BRACKET_WORDS_PATH.is_file():
            data = json.loads(_LEGACY_BRACKET_WORDS_PATH.read_text(encoding="utf-8"))
        else:
            data = {"parentheses": [], "square_brackets": []}
        db.add(AppConfig(key=_BRACKET_WORDS_KEY, value=data))
        await db.flush()
        return data

    return row.value


@router.get("/bracket-words")
async def get_bracket_words(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    return await _get_bracket_words_data(db)


@router.patch("/bracket-words")
async def update_bracket_words(
    body: BracketWordsUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    data = await _get_bracket_words_data(db)

    if body.parentheses is not None:
        data["parentheses"] = sorted({w.strip().lower() for w in body.parentheses if w.strip()})
    if body.square_brackets is not None:
        data["square_brackets"] = sorted({w.strip().lower() for w in body.square_brackets if w.strip()})

    row = (await db.execute(
        select(AppConfig).where(AppConfig.key == _BRACKET_WORDS_KEY)
    )).scalar_one_or_none()
    if row:
        row.value = data
    else:
        db.add(AppConfig(key=_BRACKET_WORDS_KEY, value=data))

    await db.flush()
    return data


# ─── Activity Log ────────────────────────────────────────────────────────────

@router.get("/activity")
async def get_activity_log(
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    rows = (await db.execute(
        select(
            AuditLog.id,
            AuditLog.action,
            AuditLog.resource_type,
            AuditLog.resource_id,
            AuditLog.details,
            AuditLog.created_at,
            User.username.label("username"),
            User.role.label("user_role"),
        )
        .outerjoin(User, AuditLog.user_id == User.id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    )).all()

    return [
        {
            "id": r.id,
            "action": r.action,
            "resource_type": r.resource_type,
            "resource_id": r.resource_id,
            "details": r.details,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "username": r.username,
            "user_role": r.user_role,
        }
        for r in rows
    ]


# ─── Dashboard ───────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def get_dashboard(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    # ── Overall stats (active files only — deleted files excluded throughout) ───
    total_files = (await db.execute(
        select(func.count(AudioFile.id)).where(AudioFile.is_deleted == False)  # noqa: E712
    )).scalar_one()

    assigned_files = (await db.execute(
        select(func.count(distinct(Assignment.audio_file_id)))
        .join(AudioFile, AudioFile.id == Assignment.audio_file_id)
        .where(AudioFile.is_deleted == False)  # noqa: E712
    )).scalar_one()

    completed_count = (await db.execute(
        select(func.count(Assignment.id))
        .join(AudioFile, AudioFile.id == Assignment.audio_file_id)
        .where(AudioFile.is_deleted == False)  # noqa: E712
        .where(Assignment.status == "completed")
    )).scalar_one()

    flagged_count = (await db.execute(
        select(func.count(SpeakerSegment.id))
        .join(AudioFile, AudioFile.id == SpeakerSegment.audio_file_id)
        .where(AudioFile.is_deleted == False)  # noqa: E712
        .where(SpeakerSegment.is_ambiguous == True)  # noqa: E712
    )).scalar_one()

    # Files with emotion annotators but fewer than 2 (need more for reliable consensus)
    _emotion_counts = (
        select(
            SpeakerSegment.audio_file_id,
            func.count(distinct(SpeakerSegment.annotator_id)).label("ann_count"),
        )
        .join(AudioFile, AudioFile.id == SpeakerSegment.audio_file_id)
        .where(AudioFile.is_deleted == False)  # noqa: E712
        .where(SpeakerSegment.source == "annotator")
        .group_by(SpeakerSegment.audio_file_id)
        .subquery()
    )
    low_annotator_files = (await db.execute(
        select(func.count()).select_from(_emotion_counts).where(_emotion_counts.c.ann_count < 2)
    )).scalar_one()

    # ── Recent activity (last 10 assignments, active files only) ──────────────
    recent_rows = (await db.execute(
        select(
            Assignment.id,
            Assignment.audio_file_id,
            AudioFile.filename,
            User.username.label("annotator"),
            Assignment.task_type,
            Assignment.status,
            Assignment.created_at,
        )
        .join(AudioFile, Assignment.audio_file_id == AudioFile.id)
        .join(User, Assignment.annotator_id == User.id)
        .where(AudioFile.is_deleted == False)  # noqa: E712
        .order_by(Assignment.created_at.desc())
        .limit(10)
    )).all()

    # ── Dataset progress (active files only) ───────────────────────────────────
    ds_files = (await db.execute(
        select(AudioFile.dataset_id, func.count(AudioFile.id).label("total"))
        .where(AudioFile.is_deleted == False)  # noqa: E712
        .group_by(AudioFile.dataset_id)
        .order_by(func.count(AudioFile.id).desc())
    )).all()

    ds_assign = (await db.execute(
        select(
            AudioFile.dataset_id,
            func.count(Assignment.id).label("total_assign"),
            func.sum(case((Assignment.status == "completed", 1), else_=0)).label("done_assign"),
        )
        .join(AudioFile, Assignment.audio_file_id == AudioFile.id)
        .where(AudioFile.is_deleted == False)  # noqa: E712
        .group_by(AudioFile.dataset_id)
    )).all()

    # Fetch dataset names
    ds_name_rows = (await db.execute(select(Dataset.id, Dataset.name))).all()
    ds_name_map = {r.id: r.name for r in ds_name_rows}

    ds_assign_map = {r.dataset_id: (r.total_assign, int(r.done_assign or 0)) for r in ds_assign}
    dataset_progress = []
    for r in ds_files:
        total_a, done_a = ds_assign_map.get(r.dataset_id, (0, 0))
        dataset_progress.append({
            "dataset_id": r.dataset_id,
            "dataset_name": ds_name_map.get(r.dataset_id, "Unassigned") if r.dataset_id else "Unassigned",
            "total_files": r.total,
            "total_assignments": total_a,
            "completed_assignments": done_a,
            "completion_rate": round(done_a / total_a, 2) if total_a else 0.0,
        })

    # ── Annotator summary (assignments on active files only) ──────────────────
    annotator_rows = (await db.execute(
        select(
            User.id,
            User.username,
            User.is_active,
            User.created_at,
            func.count(Assignment.id).label("assigned"),
            func.sum(case((Assignment.status == "completed", 1), else_=0)).label("completed"),
        )
        .outerjoin(Assignment, User.id == Assignment.annotator_id)
        .outerjoin(AudioFile, (AudioFile.id == Assignment.audio_file_id) & (AudioFile.is_deleted == False))  # noqa: E712
        .where(User.role == "annotator")
        .group_by(User.id)
        .order_by(User.username)
    )).all()

    # ── Task breakdown by type (active files only) ─────────────────────────────
    task_rows = (await db.execute(
        select(
            Assignment.task_type,
            func.count(Assignment.id).label("total"),
            func.sum(case((Assignment.status == "completed", 1), else_=0)).label("done"),
        )
        .join(AudioFile, AudioFile.id == Assignment.audio_file_id)
        .where(AudioFile.is_deleted == False)  # noqa: E712
        .group_by(Assignment.task_type)
    )).all()
    task_breakdown = {
        r.task_type: {"total": r.total, "done": int(r.done or 0)}
        for r in task_rows
    }

    return {
        "stats": {
            "total_files": total_files,
            "assigned_files": assigned_files,
            "completed_assignments": completed_count,
            "flagged_segments": flagged_count,
            "low_annotator_files": low_annotator_files,
        },
        "task_breakdown": task_breakdown,
        "recent_activity": [
            {
                "id": r.id,
                "audio_file_id": r.audio_file_id,
                "filename": r.filename,
                "annotator": r.annotator,
                "task_type": r.task_type,
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in recent_rows
        ],
        "dataset_progress": dataset_progress,
        "annotator_summary": [
            {
                "id": r.id,
                "username": r.username,
                "is_active": r.is_active,
                "assigned": r.assigned or 0,
                "completed": int(r.completed or 0),
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in annotator_rows
        ],
    }
