"""
Review endpoints.

Emotion:   per-annotator tag lists with aggregation (no finalization)
Collab:    speaker / gender / transcription segments with edit history
IAA:       inter-annotator agreement metrics
"""
from itertools import combinations as _combinations
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_admin
from app.database import get_db
from app.models.models import (
    AudioFile,
    SegmentEditHistory,
    SpeakerSegment,
    TranscriptionSegment,
    User,
)

router = APIRouter()

_VALID_COLLAB = {"speaker", "gender", "transcription"}


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

        out.append({
            "id": af.id,
            "filename": af.filename,
            "duration": af.duration,
            "language": af.language,
            "total_segments": total_segments,
            "emotion_annotators": emotion_annotators,
            "collaborative_locked_speaker": af.collaborative_locked_speaker,
            "collaborative_locked_gender": af.collaborative_locked_gender,
            "collaborative_locked_transcription": af.collaborative_locked_transcription,
            "annotator_remarks": af.annotator_remarks,
        })
    return out


# ─── Emotion review ───────────────────────────────────────────────────────────

@router.get("/{file_id}/emotion")
async def get_emotion_review(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Per-annotator emotion tag lists per segment, with aggregation counts."""
    baseline = (await db.execute(
        select(SpeakerSegment)
        .where(SpeakerSegment.audio_file_id == file_id)
        .where(SpeakerSegment.source == "pre_annotated")
        .order_by(SpeakerSegment.start_time)
    )).scalars().all()
    if not baseline:
        raise HTTPException(status_code=404, detail="No baseline segments found.")

    ann_rows = (await db.execute(
        select(SpeakerSegment, User.username)
        .join(User, SpeakerSegment.annotator_id == User.id)
        .where(SpeakerSegment.audio_file_id == file_id)
        .where(SpeakerSegment.source == "annotator")
        .order_by(SpeakerSegment.start_time)
    )).all()

    # Map (start, end) → list of annotator entries
    seg_map: dict[tuple, list] = {}
    for seg, username in ann_rows:
        key = (round(seg.start_time, 3), round(seg.end_time, 3))
        seg_map.setdefault(key, []).append({
            "username": username,
            "emotions": seg.emotion or [],
            "is_ambiguous": seg.is_ambiguous,
        })

    out = []
    for seg in baseline:
        key = (round(seg.start_time, 3), round(seg.end_time, 3))
        annotations = seg_map.get(key, [])

        # Count how many annotators selected each emotion label
        emotion_counts: dict[str, int] = {}
        for ann in annotations:
            for label in ann["emotions"]:
                emotion_counts[label] = emotion_counts.get(label, 0) + 1

        out.append({
            "segment_id": seg.id,
            "start_time": seg.start_time,
            "end_time": seg.end_time,
            "speaker_label": seg.speaker_label,
            "annotations": annotations,
            "emotion_counts": emotion_counts,
        })
    return out


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


# ─── IAA metrics ──────────────────────────────────────────────────────────────

@router.get("/{file_id}/iaa")
async def get_iaa_metrics(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Compute Inter-Annotator Agreement for emotion labels on a file.
    Two annotators agree on a segment when their sorted emotion tag sets are identical.
    """
    rows = (await db.execute(
        select(
            SpeakerSegment.annotator_id,
            SpeakerSegment.start_time,
            SpeakerSegment.end_time,
            SpeakerSegment.emotion,
        )
        .where(SpeakerSegment.audio_file_id == file_id)
        .where(SpeakerSegment.source == "annotator")
    )).fetchall()

    # Map (start, end) → {annotator_id: frozenset of emotion tags}
    seg_map: dict[tuple, dict[int, frozenset]] = {}
    for annotator_id, start, end, emotion in rows:
        key = (round(float(start), 3), round(float(end), 3))
        tags = frozenset(emotion) if emotion else frozenset()
        seg_map.setdefault(key, {})[annotator_id] = tags

    all_annotators = {ann for labels in seg_map.values() for ann in labels}
    multi = {k: v for k, v in seg_map.items() if len(v) >= 2}

    if not multi:
        return {
            "file_id": file_id,
            "annotator_count": len(all_annotators),
            "segment_count": len(seg_map),
            "annotated_count": 0,
            "percent_agreement": None,
            "fleiss_kappa": None,
        }

    # Pairwise percent agreement: agree when tag sets are identical
    pair_agreements: list[int] = []
    for labels in multi.values():
        ids = list(labels.keys())
        for a1, a2 in _combinations(ids, 2):
            pair_agreements.append(1 if labels[a1] == labels[a2] else 0)
    percent_agreement = round(sum(pair_agreements) / len(pair_agreements), 3) if pair_agreements else None

    # Fleiss' kappa — treat each unique tag-set as a distinct category
    n_vals = [len(v) for v in multi.values()]
    fleiss_kappa = None
    if len(set(n_vals)) == 1:
        n = n_vals[0]
        if n >= 2:
            N = len(multi)
            subjects = list(multi.values())
            total_ratings = N * n
            cat_counts: dict[frozenset, int] = {}
            for s in subjects:
                for tag_set in s.values():
                    cat_counts[tag_set] = cat_counts.get(tag_set, 0) + 1
            P_e = sum((c / total_ratings) ** 2 for c in cat_counts.values())
            P_i_list = []
            for s in subjects:
                n_ij: dict[frozenset, int] = {}
                for tag_set in s.values():
                    n_ij[tag_set] = n_ij.get(tag_set, 0) + 1
                P_i = sum(v * (v - 1) for v in n_ij.values()) / (n * (n - 1))
                P_i_list.append(P_i)
            P_bar = sum(P_i_list) / N
            if P_e < 1:
                fleiss_kappa = round((P_bar - P_e) / (1 - P_e), 3)

    return {
        "file_id": file_id,
        "annotator_count": len(all_annotators),
        "segment_count": len(seg_map),
        "annotated_count": len(multi),
        "percent_agreement": percent_agreement,
        "fleiss_kappa": fleiss_kappa,
    }


async def _get_history(db, seg_type: str, seg_id: int) -> list[dict]:
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
