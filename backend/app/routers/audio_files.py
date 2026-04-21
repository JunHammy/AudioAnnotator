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
from app.services.sse import sse_manager
from app.database import get_db
from app.models.models import (
    Assignment, AudioFile, Dataset, FinalAnnotation, OriginalJSONStore,
    SegmentEditHistory, SpeakerSegment, TranscriptionSegment, User,
)
from app.schemas.schemas import AudioFileAdminResponseUpdate, AudioFileMetadataUpdate, AudioFileResponse, AudioFileLockUpdate, AudioFileRemarksUpdate
from app.services.audit import write_audit_log
from app.services.notifications import create_notification

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
            return f"speaker_{n}"
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
    include_deleted: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(AudioFile).options(selectinload(AudioFile.original_json_store))
    if not (include_deleted and current_user.role == "admin"):
        q = q.where(AudioFile.is_deleted == False)
    result = await db.execute(q.order_by(AudioFile.created_at.desc()))
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
    if af.is_deleted and _user.role != "admin":
        raise HTTPException(status_code=404, detail="Audio file not found")
    return af


@router.post("", response_model=AudioFileResponse, status_code=status.HTTP_201_CREATED)
async def upload_audio_file(
    audio:               UploadFile          = File(...),
    emotion_gender_json: Optional[UploadFile] = File(default=None),
    speaker_json:        Optional[UploadFile] = File(default=None),
    transcription_json:  Optional[UploadFile] = File(default=None),
    language:            str                  = Form(""),
    dataset_id:          Optional[int]        = Form(default=None),
    db:    AsyncSession  = Depends(get_db),
    admin: User          = Depends(require_admin),
):
    """
    Upload an audio file with optional JSON annotation files.
    Only the audio file is required — JSONs are optional.
    Providing a subset of JSONs seeds only those segment types.
    """
    # ── Validate and sanitize filename ────────────────────────────────────────
    audio_name = _safe_name(audio.filename or "", "audio filename")
    if Path(audio_name).suffix.lower() not in _ALLOWED_AUDIO:
        raise HTTPException(status_code=400, detail="Audio file must be .wav or .mp3.")

    base_upload = Path(settings.upload_dir).resolve()
    dest_dir = base_upload
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = _resolve_safe(dest_dir, audio_name)

    # ── Duplicate check ───────────────────────────────────────────────────────
    existing = await db.execute(
        select(AudioFile)
        .where(AudioFile.filename == audio_name)
        .where(AudioFile.is_deleted == False)  # noqa: E712
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"File '{audio_name}' already exists.")

    # ── Parse optional JSONs ──────────────────────────────────────────────────
    _MAX_JSON_BYTES = 10 * 1024 * 1024  # 10 MB

    async def _read_json(upload: UploadFile) -> dict:
        raw = await upload.read()
        if len(raw) > _MAX_JSON_BYTES:
            raise HTTPException(status_code=413, detail=f"JSON file '{upload.filename}' exceeds 10 MB limit")
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid JSON in '{upload.filename}': {exc}")

    eg_data = sp_data = tr_data = None
    if emotion_gender_json and emotion_gender_json.filename:
        eg_data = await _read_json(emotion_gender_json)
    if speaker_json and speaker_json.filename:
        sp_data = await _read_json(speaker_json)
    if transcription_json and transcription_json.filename:
        tr_data = await _read_json(transcription_json)

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

    # ── Validate dataset if provided ──────────────────────────────────────────
    if dataset_id is not None:
        ds_check = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
        if not ds_check.scalar_one_or_none():
            raise HTTPException(status_code=400, detail=f"Dataset {dataset_id} not found.")

    # ── Create AudioFile record ───────────────────────────────────────────────
    db_file = AudioFile(
        filename=audio_name,
        dataset_id=dataset_id,
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
    await write_audit_log(db, admin.id, "upload_audio", "audio_file", db_file.id,
                          {"filename": audio_name, "language": language.strip() or None,
                           "dataset_id": dataset_id})
    # Reload with json_store eager-loaded so AudioFileResponse.json_types is populated
    result2 = await db.execute(
        select(AudioFile)
        .options(selectinload(AudioFile.original_json_store))
        .where(AudioFile.id == db_file.id)
    )
    return result2.scalar_one()


@router.post("/{file_id}/json", response_model=AudioFileResponse, status_code=status.HTTP_201_CREATED)
async def add_json_to_file(
    file_id: int,
    json_type: str = Form(...),
    json_file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    Attach or replace a JSON annotation file on an existing audio file.
    Segments are seeded only if none of that type exist yet (safe for files already in progress).
    """
    if json_type not in ("emotion_gender", "speaker", "transcription"):
        raise HTTPException(status_code=400, detail="json_type must be emotion_gender, speaker, or transcription")
    if not (json_file.filename or "").lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="File must be .json")

    result = await db.execute(
        select(AudioFile)
        .options(selectinload(AudioFile.original_json_store))
        .where(AudioFile.id == file_id)
    )
    af = result.scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")

    _MAX_JSON_BYTES = 10 * 1024 * 1024  # 10 MB
    raw = await json_file.read()
    if len(raw) > _MAX_JSON_BYTES:
        raise HTTPException(status_code=413, detail="JSON file exceeds 10 MB limit")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")

    # Upsert OriginalJSONStore
    existing_store = next((j for j in af.original_json_store if j.json_type == json_type), None)
    if existing_store:
        existing_store.data = data
    else:
        db.add(OriginalJSONStore(audio_file_id=file_id, json_type=json_type, data=data))

    # Seed segments only if none of this type exist yet (non-destructive)
    if json_type == "speaker":
        existing_check = (await db.execute(
            select(SpeakerSegment.id).where(SpeakerSegment.audio_file_id == file_id).limit(1)
        )).scalar_one_or_none()
        if not existing_check:
            spk_segs_raw = data.get("speakers", [])
            for s in spk_segs_raw:
                db.add(SpeakerSegment(
                    audio_file_id=file_id,
                    annotator_id=admin.id,
                    speaker_label=_renumber_speaker(s.get("speaker", "")),
                    start_time=round(float(s.get("start_time", 0)), 3),
                    end_time=round(float(s.get("end_time", 0)), 3),
                    gender="unk",
                    emotion=None,
                    source="pre_annotated",
                ))
            if spk_segs_raw and not af.duration:
                af.duration = round(max((s.get("end_time", 0) for s in spk_segs_raw), default=0.0), 2)
            if not af.num_speakers:
                ns = data.get("num_speakers") or len({s.get("speaker", "") for s in spk_segs_raw})
                af.num_speakers = max(int(ns), 1) if ns else None

    elif json_type == "transcription":
        # Only skip if an admin has already linked transcription segments for this file.
        # Annotator-created segments (e.g. auto-created blank ones from speaker segment
        # creation) must NOT block the admin from linking the canonical transcription JSON.
        admin_existing = (await db.execute(
            select(TranscriptionSegment.id)
            .where(TranscriptionSegment.audio_file_id == file_id)
            .where(TranscriptionSegment.annotator_id == admin.id)
            .limit(1)
        )).scalar_one_or_none()
        if not admin_existing:
            texts = data.get("texts", [])
            new_trans = []
            for t in texts:
                seg = TranscriptionSegment(
                    audio_file_id=file_id,
                    annotator_id=admin.id,
                    start_time=round(float(t.get("start_time", 0)), 3),
                    end_time=round(float(t.get("end_time", 0)), 3),
                    original_text=t.get("text", ""),
                )
                db.add(seg)
                new_trans.append(seg)
            if texts and not af.duration:
                af.duration = round(max((t.get("end_time", 0) for t in texts), default=0.0), 2)
            await db.flush()
            # Notify open annotate pages so they reload transcription data without
            # requiring a manual refresh.
            for seg in new_trans:
                await db.refresh(seg)
            await sse_manager.broadcast(file_id, {
                "type": "transcription_linked",
                "data": {
                    "segments": [
                        {
                            "id": s.id,
                            "start_time": s.start_time,
                            "end_time": s.end_time,
                            "original_text": s.original_text,
                            "edited_text": s.edited_text,
                            "notes": s.notes,
                            "updated_at": s.updated_at.isoformat(),
                        }
                        for s in new_trans
                    ]
                },
            })

    # emotion_gender: stored in JSON store only; used during review finalisation

    await db.flush()
    await write_audit_log(db, admin.id, "link_json", "audio_file", file_id,
                          {"json_type": json_type, "filename": af.filename})
    result2 = await db.execute(
        select(AudioFile)
        .options(selectinload(AudioFile.original_json_store))
        .where(AudioFile.id == file_id)
    )
    return result2.scalar_one()


@router.get("/{file_id}/stream")
async def stream_audio(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(AudioFile).where(AudioFile.id == file_id))
    af = result.scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")

    # Annotators may only stream files they are assigned to
    if current_user.role != "admin":
        assigned = await db.execute(
            select(Assignment).where(
                Assignment.audio_file_id == file_id,
                Assignment.annotator_id == current_user.id,
            ).limit(1)
        )
        if not assigned.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Not assigned to this file")

    path = Path(af.file_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Audio file missing from disk")

    media_type = "audio/mpeg" if path.suffix.lower() == ".mp3" else "audio/wav"
    return FileResponse(path=str(path), media_type=media_type, filename=af.filename)


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_audio_file(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Soft-delete (archive) an audio file. Data is preserved; file disappears from all lists."""
    result = await db.execute(select(AudioFile).where(AudioFile.id == file_id))
    af = result.scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")
    af.is_deleted = True
    await write_audit_log(db, admin.id, "archive_audio", "audio_file", file_id,
                          {"filename": af.filename})
    await db.flush()


@router.delete("/{file_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def permanently_delete_audio_file(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Hard-delete an archived audio file and all associated data. Irreversible."""
    result = await db.execute(select(AudioFile).where(AudioFile.id == file_id))
    af = result.scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")
    if not af.is_deleted:
        raise HTTPException(status_code=400, detail="File must be archived before permanent deletion.")

    filename = af.filename
    file_path = af.file_path

    # Cascade deletes (SQLAlchemy relationships handle most, but do explicit for clarity)
    await db.execute(sa_delete(SpeakerSegment).where(SpeakerSegment.audio_file_id == file_id))
    await db.execute(sa_delete(TranscriptionSegment).where(TranscriptionSegment.audio_file_id == file_id))
    await db.execute(sa_delete(Assignment).where(Assignment.audio_file_id == file_id))
    await db.execute(sa_delete(FinalAnnotation).where(FinalAnnotation.audio_file_id == file_id))
    await db.execute(sa_delete(OriginalJSONStore).where(OriginalJSONStore.audio_file_id == file_id))
    await db.delete(af)
    await db.flush()

    # Remove file from disk
    try:
        Path(file_path).unlink(missing_ok=True)
    except Exception:
        pass

    await write_audit_log(db, admin.id, "permanent_delete_audio", "audio_file", file_id,
                          {"filename": filename})


@router.patch("/{file_id}/restore", response_model=AudioFileResponse)
async def restore_audio_file(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Restore a soft-deleted audio file."""
    result = await db.execute(
        select(AudioFile)
        .options(selectinload(AudioFile.original_json_store))
        .where(AudioFile.id == file_id)
    )
    af = result.scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")
    af.is_deleted = False
    await write_audit_log(db, admin.id, "restore_audio", "audio_file", file_id,
                          {"filename": af.filename})
    await db.flush()
    await db.refresh(af)
    return af


@router.get("/{file_id}/annotator-count")
async def get_annotator_count(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Return the number of distinct annotators assigned to this file."""
    result = await db.execute(
        select(Assignment.annotator_id)
        .where(Assignment.audio_file_id == file_id)
        .distinct()
    )
    count = len(result.fetchall())
    return {"count": count}


@router.patch("/{file_id}/dataset", response_model=AudioFileResponse)
async def set_file_dataset(
    file_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Assign or unassign a file to a dataset. Body: { dataset_id: int | null }"""
    result = await db.execute(
        select(AudioFile)
        .options(selectinload(AudioFile.original_json_store))
        .where(AudioFile.id == file_id)
    )
    af = result.scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")

    new_dataset_id = body.get("dataset_id")
    if new_dataset_id is not None:
        ds_check = await db.execute(select(Dataset).where(Dataset.id == new_dataset_id))
        if not ds_check.scalar_one_or_none():
            raise HTTPException(status_code=400, detail=f"Dataset {new_dataset_id} not found.")
    af.dataset_id = new_dataset_id
    await db.flush()
    await db.refresh(af)
    return af


@router.patch("/{file_id}/remarks", response_model=AudioFileResponse)
async def update_remarks(
    file_id: int,
    body: AudioFileRemarksUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Any assigned annotator (or admin) can update the file-level remarks."""
    result = await db.execute(
        select(AudioFile)
        .options(selectinload(AudioFile.original_json_store))
        .where(AudioFile.id == file_id)
    )
    af = result.scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")

    # Annotators must be assigned to this file
    if current_user.role == "annotator":
        assigned = (await db.execute(
            select(Assignment).where(
                Assignment.audio_file_id == file_id,
                Assignment.annotator_id == current_user.id,
            )
        )).scalars().first()
        if not assigned:
            raise HTTPException(status_code=403, detail="Not assigned to this file")

    af.annotator_remarks = body.annotator_remarks
    await db.flush()
    await db.refresh(af)
    return af


@router.patch("/{file_id}/admin-response", response_model=AudioFileResponse)
async def update_admin_response(
    file_id: int,
    body: AudioFileAdminResponseUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Admin-only: write or clear a response to the annotator's remarks for a file."""
    result = await db.execute(
        select(AudioFile)
        .options(selectinload(AudioFile.original_json_store))
        .where(AudioFile.id == file_id)
    )
    af = result.scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")

    af.admin_response = body.admin_response or None
    await write_audit_log(
        db, _admin.id, "admin_response",
        resource_type="audio_file", resource_id=file_id,
        details={"filename": af.filename, "cleared": af.admin_response is None},
    )

    # Notify all annotators assigned to this file when a response is written
    if af.admin_response:
        annotator_ids = (await db.execute(
            select(Assignment.annotator_id)
            .where(Assignment.audio_file_id == file_id)
            .distinct()
        )).scalars().all()
        for uid in annotator_ids:
            await create_notification(
                db,
                user_id=uid,
                notif_type="admin_response",
                message=f"Admin responded to your remarks on {af.filename}",
                audio_file_id=file_id,
            )
            await sse_manager.broadcast_user(uid, {
                "type": "notification",
                "data": {
                    "notif_type": "admin_response",
                    "message": f"Admin responded to your remarks on {af.filename}",
                    "audio_file_id": file_id,
                },
            })

    await db.flush()
    await db.refresh(af)
    return af


@router.patch("/{file_id}/metadata", response_model=AudioFileResponse)
async def update_file_metadata(
    file_id: int,
    body: AudioFileMetadataUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Update editable metadata (language, num_speakers) for an uploaded audio file."""
    result = await db.execute(
        select(AudioFile)
        .options(selectinload(AudioFile.original_json_store))
        .where(AudioFile.id == file_id)
    )
    af = result.scalar_one_or_none()
    if not af:
        raise HTTPException(status_code=404, detail="Audio file not found")

    changed: dict = {}
    if body.language is not None and body.language != af.language:
        changed["language"] = {"from": af.language, "to": body.language}
        af.language = body.language
    if body.num_speakers is not None and body.num_speakers != af.num_speakers:
        changed["num_speakers"] = {"from": af.num_speakers, "to": body.num_speakers}
        af.num_speakers = body.num_speakers

    if changed:
        await write_audit_log(
            db, _admin.id, "update_file_metadata",
            resource_type="audio_file", resource_id=file_id,
            details={"filename": af.filename, "changes": changed},
        )
        await db.flush()
        await db.refresh(af)

    return af


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
    completed_assignments: list[Assignment] = []
    if body.locked:
        af.locked_by = admin.id
        af.locked_at = datetime.now(timezone.utc)
    else:
        # Unlock: clear lock metadata only if all four tasks are now unlocked
        if not any([
            af.collaborative_locked_speaker,
            af.collaborative_locked_gender,
            af.collaborative_locked_transcription,
            af.collaborative_locked_emotion,
        ]):
            af.locked_by = None
            af.locked_at = None

        # Reopen all completed assignments for this task type so annotators
        # can edit again. Without this the task shows "completed" but is editable,
        # which is incoherent.
        completed_assignments = (await db.execute(
            select(Assignment)
            .where(Assignment.audio_file_id == file_id)
            .where(Assignment.task_type == body.task_type)
            .where(Assignment.status == "completed")
        )).scalars().all()
        for a in completed_assignments:
            a.status = "in_progress"
            a.completed_at = None

    await db.flush()
    await db.refresh(af)

    await sse_manager.broadcast(file_id, {
        "type": "lock_changed",
        "data": {
            "locked_speaker": af.collaborative_locked_speaker,
            "locked_gender": af.collaborative_locked_gender,
            "locked_transcription": af.collaborative_locked_transcription,
            "locked_emotion": af.collaborative_locked_emotion,
        },
    })

    # Notify each affected annotator so their My Tasks updates live
    if not body.locked and completed_assignments:
        for a in completed_assignments:
            await sse_manager.broadcast_user(a.annotator_id, {
                "type": "assignment_created",
                "data": {"audio_file_id": file_id, "task_type": body.task_type},
            })

    return af
