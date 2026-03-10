import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user, require_admin
from app.config import settings
from app.database import get_db
from app.models.models import (
    Assignment, AudioFile, FinalAnnotation, OriginalJSONStore,
    SegmentEditHistory, SpeakerSegment, TranscriptionSegment, User,
)
from app.schemas.schemas import AudioFileResponse, AudioFileLockUpdate

router = APIRouter()

# ── Validation helpers ────────────────────────────────────────────────────────

_SAFE_NAME_RE    = re.compile(r"^[a-zA-Z0-9_\-\.]{1,100}$")
_ALLOWED_AUDIO   = {".wav", ".mp3"}
_ALLOWED_JSON    = {".json"}


def _safe_name(value: str, label: str) -> str:
    """Reject names containing path separators or unsafe characters."""
    name = Path(value).name  # strip any directory component
    if not name or not _SAFE_NAME_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {label}: only letters, digits, hyphens, underscores, and dots allowed (max 100 chars).",
        )
    return name


def _resolve_safe(base: Path, *parts: str) -> Path:
    """Resolve a path and confirm it stays inside base (prevents traversal)."""
    target = (base / Path(*parts)).resolve()
    if not str(target).startswith(str(base.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path: directory traversal detected.")
    return target


# ── Segment seeding helpers (mirrors dbTools logic) ───────────────────────────

def _renumber_speaker(label: str) -> str:
    lower = label.lower()
    if lower.startswith("speaker_"):
        try:
            n = int(lower.split("_", 1)[1])
            return f"speaker_{n + 1}"
        except ValueError:
            pass
    return label


def _best_overlap(seg_start: float, seg_end: float, windows: list) -> dict | None:
    best, best_ov = None, 0.0
    for w in windows:
        ov = min(seg_end, w["end_time"]) - max(seg_start, w["start_time"])
        if ov > best_ov:
            best_ov, best = ov, w
    return best


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[AudioFileResponse])
async def list_audio_files(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AudioFile)
        .options(selectinload(AudioFile.original_json_store))
        .order_by(AudioFile.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{file_id}", response_model=AudioFileResponse)
async def get_audio_file(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(AudioFile)
        .options(selectinload(AudioFile.original_json_store))
        .where(AudioFile.id == file_id)
    )
    af = result.scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")
    return af


@router.post("", response_model=AudioFileResponse, status_code=status.HTTP_201_CREATED)
async def upload_audio_file(
    audio:               UploadFile          = File(...),
    emotion_gender_json: Optional[UploadFile] = File(default=None),
    speaker_json:        Optional[UploadFile] = File(default=None),
    transcription_json:  Optional[UploadFile] = File(default=None),
    subfolder:           str                  = Form(""),
    language:            str                  = Form(""),
    db:    AsyncSession  = Depends(get_db),
    admin: User          = Depends(require_admin),
):
    """
    Upload an audio file with optional JSON annotation files.
    Only the audio file is required — JSONs are optional.
    Providing a subset of JSONs seeds only those segment types.
    """
    # ── Validate and sanitize filenames / subfolder ───────────────────────────
    audio_name = _safe_name(audio.filename or "", "audio filename")
    if Path(audio_name).suffix.lower() not in _ALLOWED_AUDIO:
        raise HTTPException(status_code=400, detail="Audio file must be .wav or .mp3.")

    safe_subfolder = _safe_name(subfolder, "subfolder") if subfolder.strip() else None

    base_upload = Path(settings.upload_dir).resolve()
    if safe_subfolder:
        dest_dir = _resolve_safe(base_upload, safe_subfolder)
    else:
        dest_dir = base_upload
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = _resolve_safe(dest_dir, audio_name)

    # ── Duplicate check ───────────────────────────────────────────────────────
    existing = await db.execute(select(AudioFile).where(AudioFile.filename == audio_name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"File '{audio_name}' already exists.")

    # ── Parse optional JSONs ──────────────────────────────────────────────────
    eg_data = sp_data = tr_data = None
    try:
        if emotion_gender_json and emotion_gender_json.filename:
            eg_data = json.loads(await emotion_gender_json.read())
        if speaker_json and speaker_json.filename:
            sp_data = json.loads(await speaker_json.read())
        if transcription_json and transcription_json.filename:
            tr_data = json.loads(await transcription_json.read())
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")

    # ── Save audio file ───────────────────────────────────────────────────────
    with dest_path.open("wb") as f:
        shutil.copyfileobj(audio.file, f)

    # ── Derive metadata from available JSONs ──────────────────────────────────
    spk_segs_raw = sp_data.get("speakers", []) if sp_data else []

    num_speakers: Optional[int] = None
    if sp_data:
        num_speakers = sp_data.get("num_speakers") or len({s.get("speaker", "") for s in spk_segs_raw}) or None
        if num_speakers:
            num_speakers = max(num_speakers, 1)

    duration_val = 0.0
    if spk_segs_raw:
        duration_val = max((s.get("end_time", 0) for s in spk_segs_raw), default=0.0)
    if not duration_val and tr_data:
        duration_val = max((t.get("end_time", 0) for t in tr_data.get("texts", [])), default=0.0)
    if not duration_val and eg_data:
        emo_wins_raw = list(eg_data.get("predictions", {}).values())
        if emo_wins_raw:
            duration_val = max(w.get("end_time", 0) for w in emo_wins_raw)

    # ── Create AudioFile record ───────────────────────────────────────────────
    db_file = AudioFile(
        filename=audio_name,
        subfolder=safe_subfolder,
        language=language.strip() or None,
        num_speakers=num_speakers,
        duration=round(duration_val, 2) if duration_val else None,
        file_path=str(dest_path),
        uploaded_by=admin.id,
    )
    db.add(db_file)
    await db.flush()

    # ── Store immutable original JSONs (only those provided) ─────────────────
    for json_type, data_val in [
        ("emotion_gender", eg_data),
        ("speaker",        sp_data),
        ("transcription",  tr_data),
    ]:
        if data_val is not None:
            db.add(OriginalJSONStore(audio_file_id=db_file.id, json_type=json_type, data=data_val))

    # ── Seed speaker segments (only if speaker JSON provided) ─────────────────
    if sp_data:
        emo_windows = sorted(
            [
                {
                    "start_time": float(e.get("start_time", 0)),
                    "end_time":   float(e.get("end_time",   0)),
                    "gender":     e.get("gender", "unk").title(),
                    "emotion":    e.get("emotion", "").title(),
                }
                for e in (eg_data.get("predictions", {}).values() if eg_data else [])
            ],
            key=lambda w: w["start_time"],
        )
        for s in spk_segs_raw:
            seg_start = float(s.get("start_time", 0))
            seg_end   = float(s.get("end_time",   0))
            win = _best_overlap(seg_start, seg_end, emo_windows)
            db.add(SpeakerSegment(
                audio_file_id=db_file.id,
                annotator_id=admin.id,
                speaker_label=_renumber_speaker(s.get("speaker", "")),
                start_time=round(seg_start, 3),
                end_time=round(seg_end, 3),
                gender=win["gender"] if win else "unk",
                emotion=win["emotion"] if win else None,
                source="pre_annotated",
            ))

    # ── Seed transcription segments (only if transcription JSON provided) ─────
    if tr_data:
        for t in tr_data.get("texts", []):
            db.add(TranscriptionSegment(
                audio_file_id=db_file.id,
                annotator_id=admin.id,
                start_time=round(float(t.get("start_time", 0)), 3),
                end_time=round(float(t.get("end_time",   0)), 3),
                original_text=t.get("text", ""),
            ))

    await db.flush()
    await db.refresh(db_file)
    # Reload with json_store eager-loaded so AudioFileResponse.json_types is populated
    result2 = await db.execute(
        select(AudioFile)
        .options(selectinload(AudioFile.original_json_store))
        .where(AudioFile.id == db_file.id)
    )
    return result2.scalar_one()


@router.get("/{file_id}/stream")
async def stream_audio(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(select(AudioFile).where(AudioFile.id == file_id))
    af = result.scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")

    path = Path(af.file_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Audio file missing from disk")

    media_type = "audio/mpeg" if path.suffix.lower() == ".mp3" else "audio/wav"
    return FileResponse(path=str(path), media_type=media_type, filename=af.filename)


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_audio_file(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Permanently delete an audio file and all linked data (segments, assignments, JSONs, disk file)."""
    result = await db.execute(select(AudioFile).where(AudioFile.id == file_id))
    af = result.scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")

    file_path = Path(af.file_path)

    # Collect segment IDs so we can purge their edit history
    spk_ids_res = await db.execute(select(SpeakerSegment.id).where(SpeakerSegment.audio_file_id == file_id))
    spk_ids = [r[0] for r in spk_ids_res.fetchall()]

    trn_ids_res = await db.execute(select(TranscriptionSegment.id).where(TranscriptionSegment.audio_file_id == file_id))
    trn_ids = [r[0] for r in trn_ids_res.fetchall()]

    # Delete edit history for segments
    if spk_ids:
        await db.execute(
            sa_delete(SegmentEditHistory).where(
                SegmentEditHistory.segment_type == "speaker",
                SegmentEditHistory.segment_id.in_(spk_ids),
            )
        )
    if trn_ids:
        await db.execute(
            sa_delete(SegmentEditHistory).where(
                SegmentEditHistory.segment_type == "transcription",
                SegmentEditHistory.segment_id.in_(trn_ids),
            )
        )

    # Delete all related DB records
    await db.execute(sa_delete(SpeakerSegment).where(SpeakerSegment.audio_file_id == file_id))
    await db.execute(sa_delete(TranscriptionSegment).where(TranscriptionSegment.audio_file_id == file_id))
    await db.execute(sa_delete(Assignment).where(Assignment.audio_file_id == file_id))
    await db.execute(sa_delete(OriginalJSONStore).where(OriginalJSONStore.audio_file_id == file_id))
    await db.execute(sa_delete(FinalAnnotation).where(FinalAnnotation.audio_file_id == file_id))
    await db.execute(sa_delete(AudioFile).where(AudioFile.id == file_id))
    await db.commit()

    # Remove physical file from disk
    try:
        if file_path.is_file():
            file_path.unlink()
    except OSError:
        pass  # Log-worthy but not fatal — DB record is already gone


@router.patch("/{file_id}/lock", response_model=AudioFileResponse)
async def toggle_task_lock(
    file_id: int,
    body: AudioFileLockUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    result = await db.execute(
        select(AudioFile)
        .options(selectinload(AudioFile.original_json_store))
        .where(AudioFile.id == file_id)
    )
    af = result.scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")

    setattr(af, f"collaborative_locked_{body.task_type}", body.locked)
    if body.locked:
        af.locked_by = admin.id
        af.locked_at = datetime.now(timezone.utc)
    else:
        # Unlock: clear lock metadata only if all three tasks are now unlocked
        if not any([
            af.collaborative_locked_speaker,
            af.collaborative_locked_gender,
            af.collaborative_locked_transcription,
        ]):
            af.locked_by = None
            af.locked_at = None

    await db.flush()
    await db.refresh(af)
    return af
