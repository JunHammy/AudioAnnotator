"""
Export service — builds structured export payloads from annotation data.

Emotion is now per-annotator: each annotator's tag list is stored as-is.
No finalization / majority voting — the export is the raw annotation data.

JSON structure per file:
{
  "<filename.wav>": {
    "language", "duration", "num_speakers", "dataset", "annotator_remarks",
    "collaborative_locked": { "speaker", "gender", "transcription" },
    "segments": [
      {
        "segment_id", "start_time", "end_time", "speaker_label", "gender",
        "transcription": { "original_text", "edited_text", "notes" } | null,
        "emotion": {
          "<annotator_username>": ["Happy", "Other:Excited"],
          ...
        } | null
      }
    ]
  }
}
"""

import csv
import io
import re
import zipfile
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    AudioFile,
    Dataset,
    SpeakerSegment,
    TranscriptionSegment,
    User,
)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_SAFE_NAME_RE = re.compile(r"[^\w\-.]")


def _safe_stem(filename: str) -> str:
    """Strip extension and sanitise for use in archive entry names."""
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    return _SAFE_NAME_RE.sub("_", stem)


async def _fetch_file(db: AsyncSession, file_id: int) -> Optional[AudioFile]:
    result = await db.execute(select(AudioFile).where(AudioFile.id == file_id))
    return result.scalar_one_or_none()


async def _fetch_dataset(db: AsyncSession, dataset_id: int) -> Optional[Dataset]:
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Core per-file export builder
# ---------------------------------------------------------------------------

async def build_file_export(db: AsyncSession, file_id: int) -> dict:
    """
    Return a fully structured export dict for a single audio file.
    The dict is keyed by filename at the top level:
      { "<filename.wav>": { metadata..., "segments": [...] } }
    """
    # --- 1. Audio file + dataset -------------------------------------------
    af_result = await db.execute(
        select(AudioFile, Dataset.name.label("dataset_name"))
        .outerjoin(Dataset, AudioFile.dataset_id == Dataset.id)
        .where(AudioFile.id == file_id)
    )
    row = af_result.first()
    if row is None:
        return {}
    af, dataset_name = row

    # --- 2. Baseline speaker segments (pre_annotated) ----------------------
    spk_result = await db.execute(
        select(SpeakerSegment)
        .where(
            SpeakerSegment.audio_file_id == file_id,
            SpeakerSegment.source == "pre_annotated",
        )
        .order_by(SpeakerSegment.start_time)
    )
    baseline_segs: list[SpeakerSegment] = list(spk_result.scalars().all())

    # --- 3. Annotator emotion copies — group by (start, end) ---------------
    ann_result = await db.execute(
        select(SpeakerSegment, User.username)
        .join(User, SpeakerSegment.annotator_id == User.id)
        .where(
            SpeakerSegment.audio_file_id == file_id,
            SpeakerSegment.source == "annotator",
        )
    )
    # { "start-end" key → { username: [emotion tags] } }
    annotator_emotions: dict[str, dict[str, list]] = {}
    for seg, username in ann_result.all():
        key = f"{seg.start_time:.3f}-{seg.end_time:.3f}"
        annotator_emotions.setdefault(key, {})[username] = seg.emotion or []

    # --- 4. Transcription segments -----------------------------------------
    tr_result = await db.execute(
        select(TranscriptionSegment)
        .where(TranscriptionSegment.audio_file_id == file_id)
        .order_by(TranscriptionSegment.start_time)
    )
    tr_by_key: dict[str, TranscriptionSegment] = {}
    for ts in tr_result.scalars().all():
        key = f"{ts.start_time:.3f}-{ts.end_time:.3f}"
        tr_by_key[key] = ts

    # --- 5. Assemble segments ----------------------------------------------
    segments_out = []
    for seg in baseline_segs:
        key = f"{seg.start_time:.3f}-{seg.end_time:.3f}"
        emotions = annotator_emotions.get(key)
        tr = tr_by_key.get(key)

        segments_out.append({
            "segment_id": seg.id,
            "start_time": seg.start_time,
            "end_time": seg.end_time,
            "speaker_label": seg.speaker_label,
            "gender": seg.gender,
            "transcription": {
                "original_text": tr.original_text,
                "edited_text": tr.edited_text,
                "notes": tr.notes,
            } if tr else None,
            "emotion": emotions if emotions else None,
        })

    file_data = {
        "language": af.language,
        "duration": af.duration,
        "num_speakers": af.num_speakers,
        "dataset": dataset_name,
        "annotator_remarks": af.annotator_remarks,
        "collaborative_locked": {
            "speaker": af.collaborative_locked_speaker,
            "gender": af.collaborative_locked_gender,
            "transcription": af.collaborative_locked_transcription,
        },
        "segments": segments_out,
    }

    # Keep filename as a convenience key so the router can access it without
    # unpacking the top-level dict.
    return {"_filename": af.filename, af.filename: file_data}


# ---------------------------------------------------------------------------
# CSV serialisation
# ---------------------------------------------------------------------------

_CSV_SEGMENT_HEADERS = [
    "filename", "language", "duration", "num_speakers", "dataset",
    "segment_id", "start_time", "end_time", "speaker_label", "gender",
    "transcription_original", "transcription_edited",
]

_CSV_VOTES_HEADERS = [
    "filename",
    "segment_id", "start_time", "end_time", "speaker_label",
    "annotator_username", "emotions",
]


def _to_csv_bytes(rows: list[list], headers: list[str]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8-sig")  # BOM for Excel compatibility


def export_data_to_csv(files_data: list[dict]) -> tuple[bytes, bytes]:
    """
    Returns (segments_csv_bytes, votes_csv_bytes) for a list of file export dicts.
    Each dict is the return value of build_file_export (has "_filename" key).
    """
    seg_rows: list[list] = []
    vote_rows: list[list] = []

    for fd in files_data:
        fname = fd["_filename"]
        file_data = fd[fname]
        lang = file_data["language"] or ""
        dur = file_data["duration"] or ""
        ns = file_data["num_speakers"] or ""
        ds = file_data["dataset"] or ""

        for s in file_data["segments"]:
            tr = s["transcription"] or {}

            seg_rows.append([
                fname, lang, dur, ns, ds,
                s["segment_id"],
                s["start_time"], s["end_time"],
                s["speaker_label"] or "",
                s["gender"] or "",
                tr.get("original_text") or "",
                tr.get("edited_text") or "",
            ])

            emotion = s["emotion"] or {}
            for username, tags in emotion.items():
                vote_rows.append([
                    fname,
                    s["segment_id"],
                    s["start_time"], s["end_time"],
                    s["speaker_label"] or "",
                    username,
                    "|".join(tags),  # pipe-separated list, e.g. "Happy|Other:Excited"
                ])

    return (
        _to_csv_bytes(seg_rows, _CSV_SEGMENT_HEADERS),
        _to_csv_bytes(vote_rows, _CSV_VOTES_HEADERS),
    )


# ---------------------------------------------------------------------------
# ZIP builder (for multi-file / CSV exports)
# ---------------------------------------------------------------------------

def build_zip(entries: dict[str, bytes]) -> bytes:
    """
    entries: { "archive/path.ext": bytes_content }
    Returns an in-memory ZIP as bytes.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    buf.seek(0)
    return buf.read()
