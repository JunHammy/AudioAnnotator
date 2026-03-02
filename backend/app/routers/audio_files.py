import os
import json
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.dependencies import get_current_user, require_admin
from app.config import settings
from app.database import get_db
from app.models.models import AudioFile, OriginalJSONStore, User
from app.schemas.schemas import AudioFileResponse, AudioFileLockUpdate
from app.services.upload import preprocess_speaker_segments, preprocess_transcription_segments

router = APIRouter()


@router.get("/", response_model=list[AudioFileResponse])
async def list_audio_files(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(select(AudioFile).order_by(AudioFile.created_at.desc()))
    return result.scalars().all()


@router.get("/{file_id}", response_model=AudioFileResponse)
async def get_audio_file(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(select(AudioFile).where(AudioFile.id == file_id))
    audio_file = result.scalar_one_or_none()
    if not audio_file:
        raise HTTPException(status_code=404, detail="Audio file not found")
    return audio_file


@router.post("/", response_model=AudioFileResponse, status_code=status.HTTP_201_CREATED)
async def upload_audio_file(
    audio: UploadFile = File(...),
    emotion_gender_json: UploadFile = File(...),
    speaker_json: UploadFile = File(...),
    transcription_json: UploadFile = File(...),
    subfolder: str = Form(""),
    language: str = Form(""),
    num_speakers: int = Form(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    upload_dir = Path(settings.upload_dir)
    if subfolder:
        upload_dir = upload_dir / subfolder
    upload_dir.mkdir(parents=True, exist_ok=True)

    dest_path = upload_dir / audio.filename
    with dest_path.open("wb") as f:
        shutil.copyfileobj(audio.file, f)

    # Parse and store raw JSONs
    eg_data = json.loads(await emotion_gender_json.read())
    sp_data = json.loads(await speaker_json.read())
    tr_data = json.loads(await transcription_json.read())

    db_file = AudioFile(
        filename=audio.filename,
        subfolder=subfolder or None,
        language=language or None,
        num_speakers=num_speakers,
        file_path=str(dest_path),
        uploaded_by=admin.id,
    )
    db.add(db_file)
    await db.flush()

    # Store immutable originals
    for json_type, data in [("emotion_gender", eg_data), ("speaker", sp_data), ("transcription", tr_data)]:
        db.add(OriginalJSONStore(audio_file_id=db_file.id, json_type=json_type, data=data))

    # TODO: preprocess and seed segments (speaker +1 shift, strip emotion prefix)
    await db.flush()
    await db.refresh(db_file)
    return db_file


@router.patch("/{file_id}/lock", response_model=AudioFileResponse)
async def toggle_task_lock(
    file_id: int,
    body: AudioFileLockUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    result = await db.execute(select(AudioFile).where(AudioFile.id == file_id))
    audio_file = result.scalar_one_or_none()
    if not audio_file:
        raise HTTPException(status_code=404, detail="Audio file not found")

    lock_col = f"collaborative_locked_{body.task_type}"
    if not hasattr(audio_file, lock_col):
        raise HTTPException(status_code=400, detail="Invalid task_type")

    setattr(audio_file, lock_col, body.locked)
    if body.locked:
        from datetime import datetime, timezone
        audio_file.locked_by = admin.id
        audio_file.locked_at = datetime.now(timezone.utc)

    await db.flush()
    await db.refresh(audio_file)
    return audio_file
