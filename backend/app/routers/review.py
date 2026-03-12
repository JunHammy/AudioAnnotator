"""
Review & Finalize endpoints.

Emotion:   3-tier resolution (Tier1=unanimous, Tier2≥0.65, Tier3=manual)
Collab:    speaker / gender / transcription segments with edit history
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_admin
from app.database import get_db
from app.models.models import (
    AudioFile,
    FinalAnnotation,
    SegmentEditHistory,
    SpeakerSegment,
    TranscriptionSegment,
    User,
)

router = APIRouter()

_VALID_COLLAB = {"speaker", "gender", "transcription"}

# Algorithm lives in the shared service module
from app.services.emotion import compute_tier as _compute_tier


# ─── File listing ──────────────────────────────────────────────────────────────

@router.get("/files")
async def list_review_files(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    files_result = await db.execute(select(AudioFile).order_by(AudioFile.created_at.desc()))
    files = files_result.scalars().all()

    out = []
    for af in files:
        emotion_annotators = (await db.execute(
            select(func.count(distinct(SpeakerSegment.annotator_id)))
            .where(SpeakerSegment.audio_file_id == af.id)
            .where(SpeakerSegment.source == "annotator")
        )).scalar_one()

        total_segments = (await db.execute(
            select(func.count(SpeakerSegment.id))
            .where(SpeakerSegment.audio_file_id == af.id)
            .where(SpeakerSegment.source == "pre_annotated")
        )).scalar_one()

        finalized_emotions = (await db.execute(
            select(func.count(FinalAnnotation.id))
            .where(FinalAnnotation.audio_file_id == af.id)
            .where(FinalAnnotation.annotation_type == "emotion")
        )).scalar_one()

        out.append({
            "id": af.id,
            "filename": af.filename,
            "subfolder": af.subfolder,
            "duration": af.duration,
            "language": af.language,
            "total_segments": total_segments,
            "emotion_annotators": emotion_annotators,
            "finalized_emotions": finalized_emotions,
            "collaborative_locked_speaker": af.collaborative_locked_speaker,
            "collaborative_locked_gender": af.collaborative_locked_gender,
            "collaborative_locked_transcription": af.collaborative_locked_transcription,
        })
    return out


# ─── Emotion review ───────────────────────────────────────────────────────────

@router.get("/{file_id}/emotion")
async def get_emotion_review(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Emotion segments grouped by baseline segment, with tier classification."""
    baseline_result = await db.execute(
        select(SpeakerSegment)
        .where(SpeakerSegment.audio_file_id == file_id)
        .where(SpeakerSegment.source == "pre_annotated")
        .order_by(SpeakerSegment.start_time)
    )
    baseline = baseline_result.scalars().all()
    if not baseline:
        raise HTTPException(status_code=404, detail="No baseline segments found.")

    # Annotator copies with user info
    ann_result = await db.execute(
        select(SpeakerSegment, User.username, User.trust_score)
        .join(User, SpeakerSegment.annotator_id == User.id)
        .where(SpeakerSegment.audio_file_id == file_id)
        .where(SpeakerSegment.source == "annotator")
        .order_by(SpeakerSegment.start_time)
    )
    ann_rows = ann_result.all()

    # Map (start, end) -> annotations list
    seg_map: dict[tuple, list] = {}
    for seg, username, trust in ann_rows:
        key = (round(seg.start_time, 3), round(seg.end_time, 3))
        seg_map.setdefault(key, []).append({
            "annotator_id": seg.annotator_id,
            "username": username,
            "trust_score": trust,
            "emotion": seg.emotion,
            "emotion_other": seg.emotion_other,
            "is_ambiguous": seg.is_ambiguous,
            "segment_id": seg.id,
        })

    # Existing final annotations
    fa_result = await db.execute(
        select(FinalAnnotation)
        .where(FinalAnnotation.audio_file_id == file_id)
        .where(FinalAnnotation.annotation_type == "emotion")
    )
    fa_map: dict[int, FinalAnnotation] = {
        fa.segment_id: fa for fa in fa_result.scalars().all()
    }

    out = []
    for seg in baseline:
        key = (round(seg.start_time, 3), round(seg.end_time, 3))
        annotations = seg_map.get(key, [])
        tier_info = _compute_tier(annotations)
        final = fa_map.get(seg.id)

        out.append({
            "segment_id": seg.id,
            "start_time": seg.start_time,
            "end_time": seg.end_time,
            "speaker_label": seg.speaker_label,
            "tier": tier_info["tier"],
            "winning_label": tier_info["winning_label"],
            "confidence": tier_info["confidence"],
            "annotations": annotations,
            "finalized": final is not None,
            "final_emotion": final.data.get("emotion") if final else None,
            "final_emotion_other": final.data.get("emotion_other") if final else None,
            "final_method": final.decision_method if final else None,
        })
    return out


class EmotionDecision(BaseModel):
    segment_id: int
    emotion: str
    emotion_other: str | None = None
    decision_method: str  # unanimous | weighted | manual


class EmotionDecisionBatch(BaseModel):
    decisions: list[EmotionDecision]


@router.post("/{file_id}/emotion/decide")
async def decide_emotion(
    file_id: int,
    body: EmotionDecision,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    seg = (await db.execute(
        select(SpeakerSegment)
        .where(SpeakerSegment.id == body.segment_id)
        .where(SpeakerSegment.audio_file_id == file_id)
    )).scalar_one_or_none()
    if not seg:
        raise HTTPException(status_code=404, detail="Segment not found.")

    fa = (await db.execute(
        select(FinalAnnotation)
        .where(FinalAnnotation.audio_file_id == file_id)
        .where(FinalAnnotation.segment_id == body.segment_id)
        .where(FinalAnnotation.annotation_type == "emotion")
    )).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    emotion_data = {"emotion": body.emotion}
    if body.emotion == "Other" and body.emotion_other:
        emotion_data["emotion_other"] = body.emotion_other

    if fa:
        fa.data = emotion_data
        fa.decision_method = body.decision_method
        fa.finalized_by = admin.id
        fa.finalized_at = now
        fa.version = fa.version + 1
    else:
        db.add(FinalAnnotation(
            audio_file_id=file_id,
            segment_id=body.segment_id,
            annotation_type="emotion",
            data=emotion_data,
            decision_method=body.decision_method,
            finalized_by=admin.id,
            finalized_at=now,
        ))

    await db.flush()
    return {"segment_id": body.segment_id, "emotion": body.emotion, "method": body.decision_method}


@router.post("/{file_id}/emotion/decide-batch")
async def decide_emotion_batch(
    file_id: int,
    body: EmotionDecisionBatch,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    now = datetime.now(timezone.utc)
    accepted = 0
    for d in body.decisions:
        fa = (await db.execute(
            select(FinalAnnotation)
            .where(FinalAnnotation.audio_file_id == file_id)
            .where(FinalAnnotation.segment_id == d.segment_id)
            .where(FinalAnnotation.annotation_type == "emotion")
        )).scalar_one_or_none()

        emotion_data = {"emotion": d.emotion}
        if d.emotion == "Other" and d.emotion_other:
            emotion_data["emotion_other"] = d.emotion_other

        if fa:
            fa.data = emotion_data
            fa.decision_method = d.decision_method
            fa.finalized_by = admin.id
            fa.finalized_at = now
            fa.version = fa.version + 1
        else:
            db.add(FinalAnnotation(
                audio_file_id=file_id,
                segment_id=d.segment_id,
                annotation_type="emotion",
                data=emotion_data,
                decision_method=d.decision_method,
                finalized_by=admin.id,
                finalized_at=now,
            ))
        accepted += 1

    await db.flush()
    return {"accepted": accepted}


# ─── Collaborative review ─────────────────────────────────────────────────────

@router.get("/{file_id}/collaborative/{task_type}")
async def get_collaborative_review(
    file_id: int,
    task_type: str,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if task_type not in _VALID_COLLAB:
        raise HTTPException(status_code=400, detail=f"task_type must be one of {sorted(_VALID_COLLAB)}")

    af = (await db.execute(select(AudioFile).where(AudioFile.id == file_id))).scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found.")

    if task_type == "transcription":
        segs = (await db.execute(
            select(TranscriptionSegment)
            .where(TranscriptionSegment.audio_file_id == file_id)
            .order_by(TranscriptionSegment.start_time)
        )).scalars().all()

        segments_out = []
        for seg in segs:
            history = await _get_history(db, "transcription", seg.id)
            segments_out.append({
                "id": seg.id,
                "start_time": seg.start_time,
                "end_time": seg.end_time,
                "original_text": seg.original_text,
                "edited_text": seg.edited_text,
                "notes": seg.notes,
                "updated_at": seg.updated_at.isoformat(),
                "edit_history": history,
            })

        return {
            "task_type": "transcription",
            "locked": af.collaborative_locked_transcription,
            "segments": segments_out,
        }

    # speaker or gender
    segs = (await db.execute(
        select(SpeakerSegment)
        .where(SpeakerSegment.audio_file_id == file_id)
        .where(SpeakerSegment.source == "pre_annotated")
        .order_by(SpeakerSegment.start_time)
    )).scalars().all()

    locked = af.collaborative_locked_speaker if task_type == "speaker" else af.collaborative_locked_gender

    segments_out = []
    for seg in segs:
        history = await _get_history(db, "speaker", seg.id)
        segments_out.append({
            "id": seg.id,
            "start_time": seg.start_time,
            "end_time": seg.end_time,
            "speaker_label": seg.speaker_label,
            "gender": seg.gender,
            "is_ambiguous": seg.is_ambiguous,
            "notes": seg.notes,
            "updated_at": seg.updated_at.isoformat(),
            "edit_history": history,
        })

    return {
        "task_type": task_type,
        "locked": locked,
        "segments": segments_out,
    }


async def _get_history(db: AsyncSession, seg_type: str, seg_id: int) -> list[dict]:
    rows = (await db.execute(
        select(SegmentEditHistory, User.username)
        .join(User, SegmentEditHistory.edited_by == User.id)
        .where(SegmentEditHistory.segment_type == seg_type)
        .where(SegmentEditHistory.segment_id == seg_id)
        .order_by(SegmentEditHistory.edited_at.desc())
    )).all()
    return [
        {
            "field_changed": h.field_changed,
            "old_value": h.old_value,
            "new_value": h.new_value,
            "username": username,
            "edited_at": h.edited_at.isoformat(),
        }
        for h, username in rows
    ]
