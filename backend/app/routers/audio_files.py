import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.dependencies import get_current_user, require_admin
from app.config import settings
from app.database import get_db
from app.models.models import AudioFile, OriginalJSONStore, SpeakerSegment, TranscriptionSegment, User
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
    result = await db.execute(select(AudioFile).order_by(AudioFile.created_at.desc()))
    return result.scalars().all()


@router.get("/{file_id}", response_model=AudioFileResponse)
async def get_audio_file(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(select(AudioFile).where(AudioFile.id == file_id))
    af = result.scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")
    return af


@router.post("", response_model=AudioFileResponse, status_code=status.HTTP_201_CREATED)
async def upload_audio_file(
    audio:               UploadFile = File(...),
    emotion_gender_json: UploadFile = File(...),
    speaker_json:        UploadFile = File(...),
    transcription_json:  UploadFile = File(...),
    subfolder:           str        = Form(""),
    language:            str        = Form(""),
    db:    AsyncSession  = Depends(get_db),
    admin: User          = Depends(require_admin),
):
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

    # ── Validate JSON uploads are valid JSON ──────────────────────────────────
    try:
        eg_data  = json.loads(await emotion_gender_json.read())
        sp_data  = json.loads(await speaker_json.read())
        tr_data  = json.loads(await transcription_json.read())
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")

    # ── Save audio file ───────────────────────────────────────────────────────
    with dest_path.open("wb") as f:
        shutil.copyfileobj(audio.file, f)

    # ── Parse metadata from speaker JSON ─────────────────────────────────────
    spk_segs_raw = sp_data.get("speakers", [])
    num_speakers = sp_data.get("num_speakers") or len({s.get("speaker", "") for s in spk_segs_raw})
    duration_val = max((s.get("end_time", 0) for s in spk_segs_raw), default=0.0)
    if not duration_val:
        emo_wins = list(eg_data.get("predictions", {}).values())
        if emo_wins:
            duration_val = max(w.get("end_time", 0) for w in emo_wins)

    # ── Create AudioFile record ───────────────────────────────────────────────
    db_file = AudioFile(
        filename=audio_name,
        subfolder=safe_subfolder,
        language=language.strip() or None,
        num_speakers=max(num_speakers, 1),
        duration=round(duration_val, 2),
        file_path=str(dest_path),
        uploaded_by=admin.id,
    )
    db.add(db_file)
    await db.flush()

    # ── Store immutable original JSONs ────────────────────────────────────────
    for json_type, data in [("emotion_gender", eg_data), ("speaker", sp_data), ("transcription", tr_data)]:
        db.add(OriginalJSONStore(audio_file_id=db_file.id, json_type=json_type, data=data))

    # ── Seed pre-annotated segments ───────────────────────────────────────────
    emo_windows = sorted(
        [
            {
                "start_time": float(e.get("start_time", 0)),
                "end_time":   float(e.get("end_time",   0)),
                "gender":     e.get("gender", "unk").title(),
                "emotion":    e.get("emotion", "").title(),
            }
            for e in eg_data.get("predictions", {}).values()
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
    return db_file


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


@router.patch("/{file_id}/lock", response_model=AudioFileResponse)
async def toggle_task_lock(
    file_id: int,
    body: AudioFileLockUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    result = await db.execute(select(AudioFile).where(AudioFile.id == file_id))
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
