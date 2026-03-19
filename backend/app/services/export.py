"""
Export service — builds structured export payloads from finalized annotation data.

All functions are pure data-fetchers that return plain dicts/lists; the router
is responsible for serialising to JSON or CSV and streaming the response.

Security notes:
  - All queries are scoped to explicit file_id / dataset_id supplied by the caller.
  - No raw SQL; SQLAlchemy ORM prevents injection.
  - Filenames in Content-Disposition are sanitised by the router before use.
"""

import csv
import io
import re
import zipfile
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    Assignment,
    AudioFile,
    Dataset,
    FinalAnnotation,
    SpeakerSegment,
    TranscriptionSegment,
    User,
)
from app.services.emotion import compute_tier

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_SAFE_NAME_RE = re.compile(r"[^\w\-.]")


def _safe_stem(filename: str) -> str:
    """Strip extension and sanitise for use in archive entry names."""
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    return _SAFE_NAME_RE.sub("_", stem)


async def _fetch_file(db: AsyncSession, file_id: int) -> Optional[AudioFile]:
    result = await db.execute(
        select(AudioFile).where(AudioFile.id == file_id)
    )
    return result.scalar_one_or_none()


async def _fetch_dataset(db: AsyncSession, dataset_id: int) -> Optional[Dataset]:
    result = await db.execute(
        select(Dataset).where(Dataset.id == dataset_id)
    )
    return result.scalar_one_or_none()


async def _file_ids_for_dataset(db: AsyncSession, dataset_id: int) -> list[int]:
    result = await db.execute(
        select(AudioFile.id).where(AudioFile.dataset_id == dataset_id)
    )
    return [r for (r,) in result.all()]


# ---------------------------------------------------------------------------
# Core per-file export builder
# ---------------------------------------------------------------------------

async def build_file_export(db: AsyncSession, file_id: int) -> dict:
    """
    Return a fully structured export dict for a single audio file.

    Structure
    ---------
    {
      "file_id", "filename", "language", "duration", "num_speakers",
      "dataset",
      "annotator_remarks",
      "collaborative_locked": { "speaker", "gender", "transcription" },
      "segments": [
        {
          "segment_id", "start_time", "end_time", "speaker_label",
          "gender",
          "transcription": { "original_text", "edited_text", "notes" } | null,
          "emotion": {
            "final_emotion", "final_emotion_other",
            "decision_method", "confidence", "tier",
            "annotator_votes": [
              { "username", "trust_score", "emotion", "emotion_other",
                "is_ambiguous" }
            ]
          } | null,
          "is_emotion_finalized"
        }
      ]
    }
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

    # --- 3. Annotator emotion copies --------------------------------------
    ann_result = await db.execute(
        select(SpeakerSegment, User.username, User.trust_score)
        .join(User, SpeakerSegment.annotator_id == User.id)
        .where(
            SpeakerSegment.audio_file_id == file_id,
            SpeakerSegment.source == "annotator",
        )
    )
    # Group by (start_time, end_time) key → list of vote dicts
    annotator_votes: dict[str, list[dict]] = {}
    for seg, username, trust in ann_result.all():
        key = f"{seg.start_time:.3f}-{seg.end_time:.3f}"
        annotator_votes.setdefault(key, []).append({
            "username": username,
            "trust_score": round(trust, 4),
            "emotion": seg.emotion,
            "emotion_other": seg.emotion_other,
            "is_ambiguous": seg.is_ambiguous,
        })

    # --- 4. Final annotations --------------------------------------------
    final_result = await db.execute(
        select(FinalAnnotation).where(
            FinalAnnotation.audio_file_id == file_id,
            FinalAnnotation.annotation_type == "emotion",
        )
    )
    finals: dict[int, FinalAnnotation] = {
        fa.segment_id: fa for fa in final_result.scalars().all()
    }

    # --- 5. Transcription segments (keyed by start-end for fast lookup) --
    tr_result = await db.execute(
        select(TranscriptionSegment)
        .where(TranscriptionSegment.audio_file_id == file_id)
        .order_by(TranscriptionSegment.start_time)
    )
    # Build lookup: round to 3dp to match speaker segment boundaries
    tr_by_key: dict[str, TranscriptionSegment] = {}
    for ts in tr_result.scalars().all():
        key = f"{ts.start_time:.3f}-{ts.end_time:.3f}"
        tr_by_key[key] = ts

    # --- 6. Assemble segments --------------------------------------------
    segments_out = []
    for seg in baseline_segs:
        key = f"{seg.start_time:.3f}-{seg.end_time:.3f}"
        votes = annotator_votes.get(key, [])
        fa = finals.get(seg.id)
        tr = tr_by_key.get(key)

        # Emotion block
        if votes or fa:
            tier_info = compute_tier(votes) if votes else {"tier": 3, "winning_label": None, "confidence": 0.0}
            emotion_block = {
                "final_emotion": fa.data.get("emotion") if fa else None,
                "final_emotion_other": fa.data.get("emotion_other") if fa else None,
                "decision_method": fa.decision_method if fa else None,
                "confidence": tier_info["confidence"],
                "tier": tier_info["tier"],
                "annotator_votes": votes,
            }
        else:
            emotion_block = None

        # Transcription block
        if tr:
            tr_block = {
                "original_text": tr.original_text,
                "edited_text": tr.edited_text,
                "notes": tr.notes,
            }
        else:
            tr_block = None

        segments_out.append({
            "segment_id": seg.id,
            "start_time": seg.start_time,
            "end_time": seg.end_time,
            "speaker_label": seg.speaker_label,
            "gender": seg.gender,
            "transcription": tr_block,
            "emotion": emotion_block,
            "is_emotion_finalized": fa is not None,
        })

    return {
        "file_id": af.id,
        "filename": af.filename,
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


# ---------------------------------------------------------------------------
# CSV serialisation
# ---------------------------------------------------------------------------

_CSV_SEGMENT_HEADERS = [
    "file_id", "filename", "language", "duration", "num_speakers", "dataset",
    "segment_id", "start_time", "end_time", "speaker_label", "gender",
    "transcription_original", "transcription_edited",
    "final_emotion", "final_emotion_other", "decision_method",
    "confidence", "tier", "is_emotion_finalized",
]

_CSV_VOTES_HEADERS = [
    "file_id", "filename",
    "segment_id", "start_time", "end_time", "speaker_label",
    "annotator_username", "annotator_trust_score",
    "emotion", "emotion_other", "is_ambiguous",
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
    """
    seg_rows: list[list] = []
    vote_rows: list[list] = []

    for fd in files_data:
        fid = fd["file_id"]
        fname = fd["filename"]
        lang = fd["language"] or ""
        dur = fd["duration"] or ""
        ns = fd["num_speakers"] or ""
        ds = fd["dataset"] or ""

        for s in fd["segments"]:
            tr = s["transcription"] or {}
            em = s["emotion"] or {}

            seg_rows.append([
                fid, fname, lang, dur, ns, ds,
                s["segment_id"],
                s["start_time"], s["end_time"],
                s["speaker_label"] or "",
                s["gender"] or "",
                tr.get("original_text") or "",
                tr.get("edited_text") or "",
                em.get("final_emotion") or "",
                em.get("final_emotion_other") or "",
                em.get("decision_method") or "",
                em.get("confidence") or "",
                em.get("tier") or "",
                s["is_emotion_finalized"],
            ])

            for v in em.get("annotator_votes", []):
                vote_rows.append([
                    fid, fname,
                    s["segment_id"],
                    s["start_time"], s["end_time"],
                    s["speaker_label"] or "",
                    v["username"],
                    v["trust_score"],
                    v["emotion"] or "",
                    v["emotion_other"] or "",
                    v["is_ambiguous"],
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
