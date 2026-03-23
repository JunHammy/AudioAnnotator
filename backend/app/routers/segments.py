from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.models import AudioFile, SegmentEditHistory, SpeakerSegment, TranscriptionSegment, User, Assignment
from app.services.sse import sse_manager
from app.schemas.schemas import (
    SpeakerSegmentCreate,
    SpeakerSegmentResponse,
    SpeakerSegmentUpdate,
    TranscriptionSegmentCreate,
    TranscriptionSegmentResponse,
    TranscriptionSegmentUpdate,
)

router = APIRouter()

STALE_ERROR = HTTPException(
    status_code=status.HTTP_409_CONFLICT,
    detail="Segment was modified by another annotator. Please reload and retry.",
)

LOCKED_ERROR = HTTPException(
    status_code=423,
    detail="This task is locked — all annotators have submitted. No further changes allowed.",
)


def _spk_dict(s: SpeakerSegment) -> dict:
    return {
        "id": s.id, "start_time": s.start_time, "end_time": s.end_time,
        "speaker_label": s.speaker_label, "gender": s.gender,
        "emotion": s.emotion, "emotion_other": s.emotion_other,
        "is_ambiguous": s.is_ambiguous, "notes": s.notes,
        "source": s.source, "updated_at": s.updated_at.isoformat(),
    }


def _trans_dict(s: TranscriptionSegment) -> dict:
    return {
        "id": s.id, "start_time": s.start_time, "end_time": s.end_time,
        "original_text": s.original_text, "edited_text": s.edited_text,
        "notes": s.notes, "updated_at": s.updated_at.isoformat(),
    }


async def _check_speaker_lock(db: AsyncSession, audio_file_id: int, user: User) -> None:
    """Raise 423 if speaker track is locked and user is not admin."""
    if user.role == "admin":
        return
    af = (await db.execute(select(AudioFile).where(AudioFile.id == audio_file_id))).scalar_one_or_none()
    if af and af.collaborative_locked_speaker:
        raise LOCKED_ERROR


async def _check_transcription_lock(db: AsyncSession, audio_file_id: int, user: User) -> None:
    """Raise 423 if transcription track is locked and user is not admin."""
    if user.role == "admin":
        return
    af = (await db.execute(select(AudioFile).where(AudioFile.id == audio_file_id))).scalar_one_or_none()
    if af and af.collaborative_locked_transcription:
        raise LOCKED_ERROR


# ─── Speaker Segments ────────────────────────────────────────────────────────

@router.get("/speaker/{audio_file_id}", response_model=list[SpeakerSegmentResponse])
async def get_speaker_segments(
    audio_file_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(SpeakerSegment)
        .where(SpeakerSegment.audio_file_id == audio_file_id)
        .order_by(SpeakerSegment.start_time)
    )
    return result.scalars().all()


@router.patch("/speaker/{segment_id}", response_model=SpeakerSegmentResponse)
async def update_speaker_segment(
    segment_id: int,
    body: SpeakerSegmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(SpeakerSegment).where(SpeakerSegment.id == segment_id))
    segment = result.scalar_one_or_none()
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    await _check_speaker_lock(db, segment.audio_file_id, current_user)

    # Optimistic locking — only enforced for label/metadata changes, not time-only (drag) changes.
    # Speaker annotators are sole editors of timing; concurrent drag conflicts are not a concern.
    has_label_changes = any(
        getattr(body, f) is not None
        for f in ["speaker_label", "gender", "emotion", "emotion_other", "notes", "is_ambiguous"]
    )
    if has_label_changes:
        client_ts = body.updated_at.replace(tzinfo=timezone.utc) if body.updated_at.tzinfo is None else body.updated_at
        server_ts = segment.updated_at.replace(tzinfo=timezone.utc) if segment.updated_at.tzinfo is None else segment.updated_at
        if client_ts < server_ts:
            raise STALE_ERROR

    # Standard fields
    for field in ["speaker_label", "gender", "emotion", "emotion_other", "notes", "is_ambiguous"]:
        new_val = getattr(body, field, None)
        if new_val is not None:
            old_val = getattr(segment, field)
            if old_val != new_val:
                db.add(SegmentEditHistory(
                    segment_type="speaker",
                    segment_id=segment_id,
                    field_changed=field,
                    old_value=str(old_val) if old_val is not None else None,
                    new_value=str(new_val),
                    edited_by=current_user.id,
                ))
                setattr(segment, field, new_val)

    # Time editing — only allowed on shared baseline segments, not per-annotator copies
    times_changed = False
    synced_trans_ids: list[int] = []
    if (body.start_time is not None or body.end_time is not None):
        if segment.source != "pre_annotated":
            raise HTTPException(status_code=400, detail="Cannot change timestamps on annotator emotion copies.")

        old_start = segment.start_time
        old_end = segment.end_time

        if body.start_time is not None and body.start_time != old_start:
            db.add(SegmentEditHistory(
                segment_type="speaker", segment_id=segment_id,
                field_changed="start_time",
                old_value=str(old_start), new_value=str(body.start_time),
                edited_by=current_user.id,
            ))
            segment.start_time = round(body.start_time, 3)
            times_changed = True

        if body.end_time is not None and body.end_time != old_end:
            db.add(SegmentEditHistory(
                segment_type="speaker", segment_id=segment_id,
                field_changed="end_time",
                old_value=str(old_end), new_value=str(body.end_time),
                edited_by=current_user.id,
            ))
            segment.end_time = round(body.end_time, 3)
            times_changed = True

        # Sync matching TranscriptionSegments to stay aligned with speaker boundaries
        trans_result = await db.execute(
            select(TranscriptionSegment)
            .where(TranscriptionSegment.audio_file_id == segment.audio_file_id)
            .where(TranscriptionSegment.start_time == old_start)
            .where(TranscriptionSegment.end_time == old_end)
        )
        for t in trans_result.scalars().all():
            t.start_time = segment.start_time
            t.end_time = segment.end_time
            synced_trans_ids.append(t.id)

    await db.flush()
    await db.refresh(segment)

    # Broadcast to other annotators on this file
    await sse_manager.broadcast(segment.audio_file_id, {"type": "speaker_updated", "data": _spk_dict(segment)})
    if times_changed and synced_trans_ids:
        updated_trans = (await db.execute(
            select(TranscriptionSegment).where(TranscriptionSegment.id.in_(synced_trans_ids))
        )).scalars().all()
        for t in updated_trans:
            await sse_manager.broadcast(segment.audio_file_id, {"type": "transcription_updated", "data": _trans_dict(t)})

    return segment


@router.post("/speaker", response_model=SpeakerSegmentResponse, status_code=status.HTTP_201_CREATED)
async def create_speaker_segment(
    body: SpeakerSegmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a new speaker segment (and matching transcription segment). Requires speaker assignment."""
    # Verify the file exists
    af = (await db.execute(select(AudioFile).where(AudioFile.id == body.audio_file_id))).scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")

    await _check_speaker_lock(db, body.audio_file_id, current_user)

    # Require active speaker assignment for this file
    assignment = (await db.execute(
        select(Assignment)
        .where(Assignment.audio_file_id == body.audio_file_id)
        .where(Assignment.annotator_id == current_user.id)
        .where(Assignment.task_type == "speaker")
    )).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=403, detail="You do not have a speaker assignment for this file.")

    new_seg = SpeakerSegment(
        audio_file_id=body.audio_file_id,
        annotator_id=current_user.id,
        speaker_label=body.speaker_label,
        start_time=round(body.start_time, 3),
        end_time=round(body.end_time, 3),
        gender=body.gender or "unk",
        source="pre_annotated",
    )
    db.add(new_seg)

    # Create a matching blank transcription segment
    new_trans = TranscriptionSegment(
        audio_file_id=body.audio_file_id,
        annotator_id=current_user.id,
        start_time=round(body.start_time, 3),
        end_time=round(body.end_time, 3),
        original_text="",
    )
    db.add(new_trans)

    await db.flush()
    await db.refresh(new_seg)
    await db.refresh(new_trans)

    await sse_manager.broadcast(body.audio_file_id, {"type": "speaker_created", "data": _spk_dict(new_seg)})
    await sse_manager.broadcast(body.audio_file_id, {"type": "transcription_created", "data": _trans_dict(new_trans)})

    return new_seg


@router.delete("/speaker/by-label", status_code=status.HTTP_204_NO_CONTENT)
async def delete_speaker_by_label(
    file_id: int,
    speaker_label: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete ALL speaker segments for a given label on a file, plus their exact-boundary transcription matches."""
    await _check_speaker_lock(db, file_id, current_user)

    assignment = (await db.execute(
        select(Assignment)
        .where(Assignment.audio_file_id == file_id)
        .where(Assignment.annotator_id == current_user.id)
        .where(Assignment.task_type == "speaker")
    )).scalar_one_or_none()
    if not assignment and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="You do not have a speaker assignment for this file.")

    segments = (await db.execute(
        select(SpeakerSegment)
        .where(SpeakerSegment.audio_file_id == file_id)
        .where(SpeakerSegment.speaker_label == speaker_label)
    )).scalars().all()

    deleted_spk_ids: list[int] = []
    deleted_trans_ids: list[int] = []
    for seg in segments:
        deleted_spk_ids.append(seg.id)
        # Delete exact-boundary transcription segments
        trans = (await db.execute(
            select(TranscriptionSegment)
            .where(TranscriptionSegment.audio_file_id == file_id)
            .where(TranscriptionSegment.start_time == seg.start_time)
            .where(TranscriptionSegment.end_time == seg.end_time)
        )).scalars().all()
        for t in trans:
            deleted_trans_ids.append(t.id)
            await db.delete(t)
        await db.delete(seg)

    await db.flush()

    for sid in deleted_spk_ids:
        await sse_manager.broadcast(file_id, {"type": "speaker_deleted", "data": {"id": sid}})
    for tid in deleted_trans_ids:
        await sse_manager.broadcast(file_id, {"type": "transcription_deleted", "data": {"id": tid}})


@router.delete("/speaker/{segment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_speaker_segment(
    segment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a speaker segment and its matching transcription segment. Requires speaker assignment."""
    segment = (await db.execute(
        select(SpeakerSegment).where(SpeakerSegment.id == segment_id)
    )).scalar_one_or_none()
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    await _check_speaker_lock(db, segment.audio_file_id, current_user)

    assignment = (await db.execute(
        select(Assignment)
        .where(Assignment.audio_file_id == segment.audio_file_id)
        .where(Assignment.annotator_id == current_user.id)
        .where(Assignment.task_type == "speaker")
    )).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=403, detail="You do not have a speaker assignment for this file.")

    file_id = segment.audio_file_id
    spk_id = segment.id

    trans_list = (await db.execute(
        select(TranscriptionSegment)
        .where(TranscriptionSegment.audio_file_id == segment.audio_file_id)
        .where(TranscriptionSegment.start_time == segment.start_time)
        .where(TranscriptionSegment.end_time == segment.end_time)
    )).scalars().all()
    trans_ids = [t.id for t in trans_list]
    for t in trans_list:
        await db.delete(t)

    await db.delete(segment)
    await db.flush()

    await sse_manager.broadcast(file_id, {"type": "speaker_deleted", "data": {"id": spk_id}})
    for tid in trans_ids:
        await sse_manager.broadcast(file_id, {"type": "transcription_deleted", "data": {"id": tid}})


# ─── Transcription Segments ──────────────────────────────────────────────────

@router.get("/transcription/{audio_file_id}", response_model=list[TranscriptionSegmentResponse])
async def get_transcription_segments(
    audio_file_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(TranscriptionSegment)
        .where(TranscriptionSegment.audio_file_id == audio_file_id)
        .order_by(TranscriptionSegment.start_time)
    )
    return result.scalars().all()


@router.post("/transcription", response_model=TranscriptionSegmentResponse, status_code=status.HTTP_201_CREATED)
async def create_transcription_segment(
    body: TranscriptionSegmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a new transcription segment. Requires transcription assignment."""
    af = (await db.execute(select(AudioFile).where(AudioFile.id == body.audio_file_id))).scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")

    await _check_transcription_lock(db, body.audio_file_id, current_user)

    assignment = (await db.execute(
        select(Assignment)
        .where(Assignment.audio_file_id == body.audio_file_id)
        .where(Assignment.annotator_id == current_user.id)
        .where(Assignment.task_type == "transcription")
    )).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=403, detail="You do not have a transcription assignment for this file.")

    new_seg = TranscriptionSegment(
        audio_file_id=body.audio_file_id,
        annotator_id=current_user.id,
        start_time=round(body.start_time, 3),
        end_time=round(body.end_time, 3),
        original_text=body.original_text or "",
    )
    db.add(new_seg)
    await db.flush()
    await db.refresh(new_seg)

    await sse_manager.broadcast(body.audio_file_id, {"type": "transcription_created", "data": _trans_dict(new_seg)})

    return new_seg


@router.delete("/transcription/{segment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transcription_segment(
    segment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a transcription segment. Requires transcription assignment."""
    segment = (await db.execute(
        select(TranscriptionSegment).where(TranscriptionSegment.id == segment_id)
    )).scalar_one_or_none()
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    await _check_transcription_lock(db, segment.audio_file_id, current_user)

    assignment = (await db.execute(
        select(Assignment)
        .where(Assignment.audio_file_id == segment.audio_file_id)
        .where(Assignment.annotator_id == current_user.id)
        .where(Assignment.task_type == "transcription")
    )).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=403, detail="You do not have a transcription assignment for this file.")

    file_id = segment.audio_file_id
    seg_id = segment.id
    await db.delete(segment)
    await db.flush()

    await sse_manager.broadcast(file_id, {"type": "transcription_deleted", "data": {"id": seg_id}})


@router.patch("/transcription/{segment_id}", response_model=TranscriptionSegmentResponse)
async def update_transcription_segment(
    segment_id: int,
    body: TranscriptionSegmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(TranscriptionSegment).where(TranscriptionSegment.id == segment_id))
    segment = result.scalar_one_or_none()
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    await _check_transcription_lock(db, segment.audio_file_id, current_user)

    # Optimistic locking — only enforced for text/notes changes, not time-only edits
    has_text_changes = body.edited_text is not None or body.notes is not None
    if has_text_changes:
        client_ts = body.updated_at.replace(tzinfo=timezone.utc) if body.updated_at.tzinfo is None else body.updated_at
        server_ts = segment.updated_at.replace(tzinfo=timezone.utc) if segment.updated_at.tzinfo is None else segment.updated_at
        if client_ts < server_ts:
            raise STALE_ERROR

    for field in ["edited_text", "notes"]:
        new_val = getattr(body, field, None)
        if new_val is not None:
            old_val = getattr(segment, field)
            if old_val != new_val:
                db.add(SegmentEditHistory(
                    segment_type="transcription",
                    segment_id=segment_id,
                    field_changed=field,
                    old_value=old_val,
                    new_value=new_val,
                    edited_by=current_user.id,
                ))
                setattr(segment, field, new_val)

    # Time editing
    if body.start_time is not None and body.start_time != segment.start_time:
        db.add(SegmentEditHistory(
            segment_type="transcription", segment_id=segment_id,
            field_changed="start_time",
            old_value=str(segment.start_time), new_value=str(body.start_time),
            edited_by=current_user.id,
        ))
        segment.start_time = round(body.start_time, 3)

    if body.end_time is not None and body.end_time != segment.end_time:
        db.add(SegmentEditHistory(
            segment_type="transcription", segment_id=segment_id,
            field_changed="end_time",
            old_value=str(segment.end_time), new_value=str(body.end_time),
            edited_by=current_user.id,
        ))
        segment.end_time = round(body.end_time, 3)

    await db.flush()
    await db.refresh(segment)

    await sse_manager.broadcast(segment.audio_file_id, {"type": "transcription_updated", "data": _trans_dict(segment)})

    return segment


# ─── Annotation View (combined data for annotate page) ───────────────────────

@router.get("/annotate/{file_id}")
async def get_annotate_data(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns all segments for the annotation view.
    - Speaker/transcription segments are the shared collaborative baseline.
    - Emotion segments are per-annotator copies (auto-created from baseline on first visit).
      Emotion copies are only created when speaker is locked (collaborative_locked_speaker=True).
      If speaker is not yet locked, returns emotion_gated=True in audio_file info.
    - Emotions always start empty (None) — never copied from baseline to prevent bias.
    """
    af = (await db.execute(select(AudioFile).where(AudioFile.id == file_id))).scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")

    emotion_gated = not af.collaborative_locked_speaker

    # Shared speaker baseline
    speaker_segs = (await db.execute(
        select(SpeakerSegment)
        .where(SpeakerSegment.audio_file_id == file_id)
        .where(SpeakerSegment.source == "pre_annotated")
        .order_by(SpeakerSegment.start_time)
    )).scalars().all()

    # Emotion copies — only created/returned when speaker is locked
    emotion_segs = []
    if not emotion_gated:
        emotion_segs = (await db.execute(
            select(SpeakerSegment)
            .where(SpeakerSegment.audio_file_id == file_id)
            .where(SpeakerSegment.annotator_id == current_user.id)
            .where(SpeakerSegment.source == "annotator")
            .order_by(SpeakerSegment.start_time)
        )).scalars().all()

        # Auto-create on first visit; emotions ALWAYS start empty (prevent bias)
        if not emotion_segs and speaker_segs:
            for seg in speaker_segs:
                db.add(SpeakerSegment(
                    audio_file_id=file_id,
                    annotator_id=current_user.id,
                    speaker_label=seg.speaker_label,
                    start_time=seg.start_time,
                    end_time=seg.end_time,
                    gender=seg.gender,
                    emotion=None,        # intentionally blank — no bias from JSON labels
                    emotion_other=None,
                    source="annotator",
                ))
            await db.flush()
            emotion_segs = (await db.execute(
                select(SpeakerSegment)
                .where(SpeakerSegment.audio_file_id == file_id)
                .where(SpeakerSegment.annotator_id == current_user.id)
                .where(SpeakerSegment.source == "annotator")
                .order_by(SpeakerSegment.start_time)
            )).scalars().all()

    trans_segs = (await db.execute(
        select(TranscriptionSegment)
        .where(TranscriptionSegment.audio_file_id == file_id)
        .order_by(TranscriptionSegment.start_time)
    )).scalars().all()

    # Annotator's assignments for this file
    my_assignments = (await db.execute(
        select(Assignment)
        .where(Assignment.audio_file_id == file_id)
        .where(Assignment.annotator_id == current_user.id)
    )).scalars().all()

    def _spk(s: SpeakerSegment) -> dict:
        return {
            "id": s.id, "start_time": s.start_time, "end_time": s.end_time,
            "speaker_label": s.speaker_label, "gender": s.gender,
            "emotion": s.emotion, "emotion_other": s.emotion_other,
            "is_ambiguous": s.is_ambiguous, "notes": s.notes,
            "source": s.source,
            "updated_at": s.updated_at.isoformat(),
        }

    def _trans(s: TranscriptionSegment) -> dict:
        return {
            "id": s.id, "start_time": s.start_time, "end_time": s.end_time,
            "original_text": s.original_text, "edited_text": s.edited_text,
            "notes": s.notes, "updated_at": s.updated_at.isoformat(),
        }

    return {
        "audio_file": {
            "id": af.id, "filename": af.filename,
            "duration": af.duration, "num_speakers": af.num_speakers,
            "language": af.language,
            "emotion_gated": emotion_gated,   # True → speaker not yet locked
            "annotator_remarks": af.annotator_remarks,
            "admin_response": af.admin_response,
            "locked_speaker": af.collaborative_locked_speaker,
            "locked_transcription": af.collaborative_locked_transcription,
        },
        "speaker_segments": [_spk(s) for s in speaker_segs],
        "emotion_segments": [_spk(s) for s in emotion_segs],
        "transcription_segments": [_trans(s) for s in trans_segs],
        "assignments": [
            {"id": a.id, "task_type": a.task_type, "status": a.status}
            for a in my_assignments
        ],
    }


@router.get("/history/{seg_type}/{seg_id}")
async def get_segment_history(
    seg_type: str,
    seg_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns the edit history for a single segment.
    Accessible to all authenticated users so annotators can see their own history.
    """
    rows = (await db.execute(
        select(SegmentEditHistory, User.username)
        .join(User, SegmentEditHistory.edited_by == User.id)
        .where(SegmentEditHistory.segment_type == seg_type)
        .where(SegmentEditHistory.segment_id == seg_id)
        .order_by(SegmentEditHistory.edited_at.desc())
        .limit(20)
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


@router.get("/emotion-progress")
async def emotion_progress(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns per-file emotion annotation progress for the current annotator.
    Only includes files where they have an emotion assignment.
    Response: [{file_id, annotated, total}]
    """
    rows = (await db.execute(
        select(
            SpeakerSegment.audio_file_id,
            func.count(SpeakerSegment.id).label("total"),
            func.count(SpeakerSegment.emotion).label("annotated"),
        )
        .where(SpeakerSegment.annotator_id == current_user.id)
        .where(SpeakerSegment.source == "annotator")
        .group_by(SpeakerSegment.audio_file_id)
    )).all()

    return [
        {"file_id": r.audio_file_id, "annotated": int(r.annotated or 0), "total": r.total}
        for r in rows
    ]
