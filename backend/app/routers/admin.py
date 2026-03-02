from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, distinct, select, case

from app.auth.dependencies import require_admin
from app.database import get_db
from app.models.models import Assignment, AudioFile, SpeakerSegment, User

router = APIRouter()


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

    # ── Recent activity (last 10 assignments) ──────────────────────────────────
    recent_rows = (await db.execute(
        select(
            Assignment.id,
            Assignment.audio_file_id,
            AudioFile.filename,
            AudioFile.subfolder,
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

    # ── Language progress ──────────────────────────────────────────────────────
    lang_files = (await db.execute(
        select(AudioFile.language, func.count(AudioFile.id).label("total"))
        .group_by(AudioFile.language)
        .order_by(func.count(AudioFile.id).desc())
    )).all()

    lang_assign = (await db.execute(
        select(
            AudioFile.language,
            func.count(Assignment.id).label("total_assign"),
            func.sum(case((Assignment.status == "completed", 1), else_=0)).label("done_assign"),
        )
        .join(AudioFile, Assignment.audio_file_id == AudioFile.id)
        .group_by(AudioFile.language)
    )).all()

    lang_assign_map = {r.language: (r.total_assign, int(r.done_assign or 0)) for r in lang_assign}
    language_progress = []
    for r in lang_files:
        total_a, done_a = lang_assign_map.get(r.language, (0, 0))
        language_progress.append({
            "language": r.language or "Unknown",
            "total_files": r.total,
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

    return {
        "stats": {
            "total_files": total_files,
            "assigned_files": assigned_files,
            "completed_assignments": completed_count,
            "flagged_segments": flagged_count,
        },
        "recent_activity": [
            {
                "id": r.id,
                "audio_file_id": r.audio_file_id,
                "filename": r.filename,
                "subfolder": r.subfolder,
                "annotator": r.annotator,
                "task_type": r.task_type,
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in recent_rows
        ],
        "language_progress": language_progress,
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
