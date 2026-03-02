from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.models import AudioFile, SegmentEditHistory, SpeakerSegment, TranscriptionSegment, User
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
