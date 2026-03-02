from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.models import AudioFile, SegmentEditHistory, SpeakerSegment, TranscriptionSegment, User, Assignment
from app.schemas.schemas import (
    SpeakerSegmentResponse,
    SpeakerSegmentUpdate,
    TranscriptionSegmentResponse,
    TranscriptionSegmentUpdate,
)

router = APIRouter()

STALE_ERROR = HTTPException(
    status_code=status.HTTP_409_CONFLICT,
    detail="Segment was modified by another annotator. Please reload and retry.",
)


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

    # Optimistic locking check
    client_ts = body.updated_at.replace(tzinfo=timezone.utc) if body.updated_at.tzinfo is None else body.updated_at
    server_ts = segment.updated_at.replace(tzinfo=timezone.utc) if segment.updated_at.tzinfo is None else segment.updated_at
    if client_ts < server_ts:
        raise STALE_ERROR

    fields = ["speaker_label", "gender", "emotion", "emotion_other", "notes", "is_ambiguous"]
    for field in fields:
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

    await db.flush()
    await db.refresh(segment)
    return segment


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

    await db.flush()
    await db.refresh(segment)
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
    Emotion segments are per-annotator copies (auto-created from baseline on first visit).
    Speaker and transcription segments are the shared collaborative baseline.
    """
    af = (await db.execute(select(AudioFile).where(AudioFile.id == file_id))).scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")

    # Shared speaker baseline
    speaker_segs = (await db.execute(
        select(SpeakerSegment)
        .where(SpeakerSegment.audio_file_id == file_id)
        .where(SpeakerSegment.source == "pre_annotated")
        .order_by(SpeakerSegment.start_time)
    )).scalars().all()

    # Annotator's emotion copies
    emotion_segs = (await db.execute(
        select(SpeakerSegment)
        .where(SpeakerSegment.audio_file_id == file_id)
        .where(SpeakerSegment.annotator_id == current_user.id)
        .where(SpeakerSegment.source == "annotator")
        .order_by(SpeakerSegment.start_time)
    )).scalars().all()

    # Auto-create emotion copies from baseline if not yet created
    if not emotion_segs and speaker_segs:
        for seg in speaker_segs:
            db.add(SpeakerSegment(
                audio_file_id=file_id,
                annotator_id=current_user.id,
                speaker_label=seg.speaker_label,
                start_time=seg.start_time,
                end_time=seg.end_time,
                gender=seg.gender,
                emotion=seg.emotion,
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
        },
        "speaker_segments": [_spk(s) for s in speaker_segs],
        "emotion_segments": [_spk(s) for s in emotion_segs],
        "transcription_segments": [_trans(s) for s in trans_segs],
        "assignments": [
            {"id": a.id, "task_type": a.task_type, "status": a.status}
            for a in my_assignments
        ],
    }
