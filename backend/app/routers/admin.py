import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, distinct, select, case

from app.auth.dependencies import require_admin
from app.database import get_db
from app.models.models import Assignment, AudioFile, AuditLog, Dataset, SpeakerSegment, User
from app.schemas.schemas import BracketWordsUpdate

# config/bracket_words.json is at repo root (4 levels up from this file)
_BRACKET_WORDS_PATH = (
    Path(__file__).parent.parent.parent.parent / "config" / "bracket_words.json"
)

router = APIRouter()


# ─── Bracket Words ────────────────────────────────────────────────────────────

@router.get("/bracket-words")
async def get_bracket_words(_admin: User = Depends(require_admin)):
    if not _BRACKET_WORDS_PATH.is_file():
        return {"parentheses": [], "square_brackets": []}
    return json.loads(_BRACKET_WORDS_PATH.read_text(encoding="utf-8"))


@router.patch("/bracket-words")
async def update_bracket_words(
    body: BracketWordsUpdate,
    _admin: User = Depends(require_admin),
):
    if _BRACKET_WORDS_PATH.is_file():
        data = json.loads(_BRACKET_WORDS_PATH.read_text(encoding="utf-8"))
    else:
        data = {"parentheses": [], "square_brackets": []}

    if body.parentheses is not None:
        # Normalise: strip whitespace, deduplicate, lowercase
        data["parentheses"] = sorted({w.strip().lower() for w in body.parentheses if w.strip()})
    if body.square_brackets is not None:
        data["square_brackets"] = sorted({w.strip().lower() for w in body.square_brackets if w.strip()})

    _BRACKET_WORDS_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
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
    # ── Overall stats ──────────────────────────────────────────────────────────
    total_files = (await db.execute(select(func.count(AudioFile.id)))).scalar_one()

    assigned_files = (await db.execute(
        select(func.count(distinct(Assignment.audio_file_id)))
    )).scalar_one()

    completed_count = (await db.execute(
        select(func.count(Assignment.id)).where(Assignment.status == "completed")
    )).scalar_one()

    flagged_count = (await db.execute(
        select(func.count(SpeakerSegment.id)).where(SpeakerSegment.is_ambiguous == True)
    )).scalar_one()

    # Files with emotion annotators but fewer than 2 (need more for reliable consensus)
    _emotion_counts = (
        select(
            SpeakerSegment.audio_file_id,
            func.count(distinct(SpeakerSegment.annotator_id)).label("ann_count"),
        )
        .where(SpeakerSegment.source == "annotator")
        .group_by(SpeakerSegment.audio_file_id)
        .subquery()
    )
    low_annotator_files = (await db.execute(
        select(func.count()).select_from(_emotion_counts).where(_emotion_counts.c.ann_count < 2)
    )).scalar_one()

    # ── Recent activity (last 10 assignments) ──────────────────────────────────
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
        .order_by(Assignment.created_at.desc())
        .limit(10)
    )).all()

    # ── Dataset progress ───────────────────────────────────────────────────────
    # Files per dataset (including unassigned bucket)
    ds_files = (await db.execute(
        select(AudioFile.dataset_id, func.count(AudioFile.id).label("total"))
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

    # ── Annotator summary ──────────────────────────────────────────────────────
    annotator_rows = (await db.execute(
        select(
            User.id,
            User.username,
            User.trust_score,
            User.is_active,
            User.created_at,
            func.count(Assignment.id).label("assigned"),
            func.sum(case((Assignment.status == "completed", 1), else_=0)).label("completed"),
        )
        .outerjoin(Assignment, User.id == Assignment.annotator_id)
        .where(User.role == "annotator")
        .group_by(User.id)
        .order_by(User.username)
    )).all()

    # ── Velocity: completed assignments per day, last 14 days ──────────────────
    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    velocity_raw = (await db.execute(
        select(
            func.date(Assignment.completed_at).label("day"),
            func.count(Assignment.id).label("count"),
        )
        .where(Assignment.status == "completed")
        .where(Assignment.completed_at >= cutoff)
        .group_by(func.date(Assignment.completed_at))
    )).all()
    velocity_map = {str(r.day): r.count for r in velocity_raw}
    today = datetime.now(timezone.utc).date()
    velocity = [
        {"date": (today - timedelta(days=i)).isoformat(), "count": velocity_map.get((today - timedelta(days=i)).isoformat(), 0)}
        for i in range(13, -1, -1)
    ]

    return {
        "stats": {
            "total_files": total_files,
            "assigned_files": assigned_files,
            "completed_assignments": completed_count,
            "flagged_segments": flagged_count,
            "low_annotator_files": low_annotator_files,
        },
        "velocity": velocity,
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
                "trust_score": round(r.trust_score, 2),
                "is_active": r.is_active,
                "assigned": r.assigned or 0,
                "completed": int(r.completed or 0),
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in annotator_rows
        ],
    }
