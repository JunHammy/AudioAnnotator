#!/usr/bin/env python3
"""
dbTools.py — Developer database population tool.
Run from the backend/ directory with the venv activated:

    python dbTools.py

Expects the following layout under AudioAnnotator/data/:

    data/
        audio/           <name>.wav   (or .mp3)
        emotion_gender/  <name>.json  — 2-s prediction windows
        speaker/         <name>.json  — speaker diarization (speaker_0 → speaker_1 on import)
        transcription/   <name>.json  — transcription text segments

Audio files are stored flat in the uploads/ directory.
"""

import asyncio
import io
import json
import random
import shutil
import sys
from pathlib import Path

# Force UTF-8 on Windows consoles that default to cp1252
if sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import select, text as sql_text

from app.auth.jwt import hash_password
from app.config import settings
from app.database import AsyncSessionLocal
from app.models.models import (
    Assignment,
    AudioFile,
    OriginalJSONStore,
    SpeakerSegment,
    TranscriptionSegment,
    User,
)

# ── constants ─────────────────────────────────────────────────────────────────

ROOT_DIR  = Path(__file__).parent.parent   # AudioAnnotator/
DATA_DIR  = ROOT_DIR / "data"              # AudioAnnotator/data/

ANNOTATORS = [
    "annotator_1", "annotator_2", "annotator_3",
    "annotator_4", "annotator_5",
]
DEFAULT_PASSWORD = "password123"

LANGUAGES = ["English", "Malay", "Chinese", "Tamil"]

# ── helpers ───────────────────────────────────────────────────────────────────

def hr(char="─", width=54):
    print(char * width)

def section(title: str):
    print()
    hr()
    print(f"  {title}")
    hr()

def ok(msg):   print(f"  ✓  {msg}")
def skip(msg): print(f"  ~  {msg}")
def err(msg):  print(f"  ✗  {msg}")
def info(msg): print(f"  ·  {msg}")


def _renumber_speaker(label: str) -> str:
    """Convert speaker_0 → speaker_1, speaker_1 → speaker_2, etc. (0-based → 1-based)."""
    if not label:
        return label
    lower = label.lower()
    if lower.startswith("speaker_"):
        try:
            n = int(lower.split("_", 1)[1])
            return f"speaker_{n + 1}"
        except ValueError:
            pass
    return label


def _overlapping_window(seg_start: float, seg_end: float, windows: list) -> dict | None:
    """Return the emotion/gender window with the greatest overlap with [seg_start, seg_end]."""
    best = None
    best_overlap = 0.0
    for w in windows:
        overlap = min(seg_end, w["end_time"]) - max(seg_start, w["start_time"])
        if overlap > best_overlap:
            best_overlap = overlap
            best = w
    return best


def _parse_speaker_json(data: dict) -> tuple:
    """
    Returns (num_speakers, duration, segments).
    Segments: list of {start_time, end_time, speaker_label}.
    speaker_0 → speaker_1.
    """
    num_speakers = data.get("num_speakers", 0)
    segs_raw = data.get("speakers", [])
    segs = [
        {
            "start_time": s["start_time"],
            "end_time":   s["end_time"],
            "speaker_label": _renumber_speaker(s.get("speaker", "")),
        }
        for s in segs_raw
    ]
    duration = max((s["end_time"] for s in segs), default=0.0)
    if not num_speakers and segs:
        labels = {s["speaker_label"] for s in segs}
        num_speakers = len(labels)
    return num_speakers, round(duration, 3), segs


def _parse_emotion_gender_json(data: dict) -> list:
    """
    Returns list of windows: {start_time, end_time, gender, emotion}.
    Values are title-cased for consistency.
    """
    predictions = data.get("predictions", {})
    windows = []
    for entry in predictions.values():
        windows.append({
            "start_time": float(entry.get("start_time", 0)),
            "end_time":   float(entry.get("end_time",   0)),
            "gender":     entry.get("gender", "unk").title(),   # male → Male
            "emotion":    entry.get("emotion", "").title(),     # neutral → Neutral
        })
    return sorted(windows, key=lambda w: w["start_time"])


def _parse_transcription_json(data: dict) -> list:
    """Returns list of {start_time, end_time, text}."""
    return [
        {
            "start_time": float(t["start_time"]),
            "end_time":   float(t["end_time"]),
            "text":       t.get("text", ""),
        }
        for t in data.get("texts", [])
    ]


# ── actions ───────────────────────────────────────────────────────────────────

async def create_annotators():
    section("Create Annotators")
    async with AsyncSessionLocal() as db:
        created = 0
        for username in ANNOTATORS:
            result = await db.execute(select(User).where(User.username == username))
            if result.scalar_one_or_none():
                skip(f"{username} already exists")
                continue
            db.add(User(
                username=username,
                password_hash=hash_password(DEFAULT_PASSWORD),
                role="annotator",
                trust_score=round(random.uniform(0.50, 0.95), 2),
                segments_reviewed=random.randint(0, 300),
                is_active=True,
            ))
            created += 1
        await db.commit()
    ok(f"Created {created} annotators  (password: {DEFAULT_PASSWORD})")


async def import_audio_files():
    section("Import Audio Files from data/")

    audio_dir   = DATA_DIR / "audio"
    emo_dir     = DATA_DIR / "emotion_gender"
    speaker_dir = DATA_DIR / "speaker"
    trans_dir   = DATA_DIR / "transcription"

    if not audio_dir.exists():
        err(f"data/audio/ not found at {audio_dir}")
        info("Place your .wav/.mp3 files under  AudioAnnotator/data/audio/")
        return

    upload_dir = Path(settings.upload_dir)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.role == "admin").limit(1))
        admin = result.scalar_one_or_none()
        if not admin:
            err("No admin user found — run seed.py first.")
            return

        imported = skipped = 0

        for audio in sorted(f for f in audio_dir.iterdir() if f.suffix.lower() in (".wav", ".mp3")):
            # Skip if already in DB
            result = await db.execute(select(AudioFile).where(AudioFile.filename == audio.name))
            if result.scalar_one_or_none():
                skipped += 1
                continue

            stem = audio.stem   # e.g. my001005_9454

            speaker_path = speaker_dir / f"{stem}.json"
            emo_path     = emo_dir     / f"{stem}.json"
            trans_path   = trans_dir   / f"{stem}.json"

            # ── Parse JSONs ──────────────────────────────────────────────────
            num_speakers = 1
            duration     = 0.0
            spk_segs     = []
            spk_data     = None
            emo_windows  = []
            emo_data     = None
            trans_segs   = []
            trans_data   = None
            language     = random.choice(LANGUAGES)

            if speaker_path.exists():
                try:
                    spk_data = json.loads(speaker_path.read_text(encoding="utf-8"))
                    num_speakers, duration, spk_segs = _parse_speaker_json(spk_data)
                except Exception as exc:
                    info(f"  speaker parse error ({stem}): {exc}")

            if emo_path.exists():
                try:
                    emo_data = json.loads(emo_path.read_text(encoding="utf-8"))
                    emo_windows = _parse_emotion_gender_json(emo_data)
                    if not duration and emo_windows:
                        duration = emo_windows[-1]["end_time"]
                except Exception as exc:
                    info(f"  emotion_gender parse error ({stem}): {exc}")

            if trans_path.exists():
                try:
                    trans_data = json.loads(trans_path.read_text(encoding="utf-8"))
                    trans_segs = _parse_transcription_json(trans_data)
                except Exception as exc:
                    info(f"  transcription parse error ({stem}): {exc}")

            # ── Copy audio to uploads/ ───────────────────────────────────────
            upload_dir.mkdir(parents=True, exist_ok=True)
            dest_file = upload_dir / audio.name
            if not dest_file.exists():
                shutil.copy2(audio, dest_file)

            # ── Create AudioFile record ──────────────────────────────────────
            af = AudioFile(
                filename=audio.name,
                duration=round(duration, 2),
                language=language,
                num_speakers=num_speakers,
                file_path=str(dest_file),
                uploaded_by=admin.id,
            )
            db.add(af)
            await db.flush()

            # ── Store original JSONs verbatim ────────────────────────────────
            for raw, json_type in (
                (emo_data,   "emotion_gender"),
                (spk_data,   "speaker"),
                (trans_data, "transcription"),
            ):
                if raw is not None:
                    db.add(OriginalJSONStore(audio_file_id=af.id, json_type=json_type, data=raw))

            # ── Pre-annotated SpeakerSegments (baseline) ─────────────────────
            # For each speaker diarization segment, map emotion/gender from the
            # emotion_gender prediction window with the greatest time overlap.
            for s in spk_segs:
                win = _overlapping_window(s["start_time"], s["end_time"], emo_windows)
                db.add(SpeakerSegment(
                    audio_file_id=af.id,
                    annotator_id=admin.id,          # baseline attributed to admin/system
                    speaker_label=s["speaker_label"],
                    start_time=round(s["start_time"], 3),
                    end_time=round(s["end_time"], 3),
                    gender=win["gender"] if win else "unk",
                    emotion=win["emotion"] if win else None,
                    source="pre_annotated",
                ))

            # ── Pre-annotated TranscriptionSegments (baseline) ───────────────
            for t in trans_segs:
                db.add(TranscriptionSegment(
                    audio_file_id=af.id,
                    annotator_id=admin.id,
                    start_time=round(t["start_time"], 3),
                    end_time=round(t["end_time"], 3),
                    original_text=t["text"],
                ))

            info(
                f"+ {audio.name}  ({num_speakers} spk, {duration:.1f}s, {language})"
                f"  →  {len(spk_segs)} speaker segs, {len(trans_segs)} transcription segs"
            )
            imported += 1

        await db.commit()

    print()
    ok(f"Imported {imported} audio files  ({skipped} already existed)")


async def create_assignments():
    section("Create Random Assignments")

    async with AsyncSessionLocal() as db:
        annotators = (
            await db.execute(select(User).where(User.role == "annotator", User.is_active == True))
        ).scalars().all()
        audio_files = (await db.execute(select(AudioFile))).scalars().all()

        if not annotators:
            err("No annotators found — create annotators first.")
            return
        if not audio_files:
            err("No audio files found — import audio files first.")
            return

        # Track existing to avoid UNIQUE constraint violations
        existing = set()
        for row in (await db.execute(select(Assignment))).scalars().all():
            existing.add((row.audio_file_id, row.annotator_id, row.task_type))

        created = 0
        for af in audio_files:
            # Emotion: 2–3 independent annotators
            pool = random.sample(annotators, min(random.randint(2, 3), len(annotators)))
            for ann in pool:
                key = (af.id, ann.id, "emotion")
                if key not in existing:
                    db.add(Assignment(
                        audio_file_id=af.id,
                        annotator_id=ann.id,
                        task_type="emotion",
                        status=random.choice(["pending", "in_progress", "completed"]),
                    ))
                    existing.add(key)
                    created += 1

            # Collaborative tasks: one annotator each
            for task_type in ("gender", "speaker", "transcription"):
                ann = random.choice(annotators)
                key = (af.id, ann.id, task_type)
                if key not in existing:
                    db.add(Assignment(
                        audio_file_id=af.id,
                        annotator_id=ann.id,
                        task_type=task_type,
                        status=random.choice(["pending", "in_progress", "completed"]),
                    ))
                    existing.add(key)
                    created += 1

        await db.commit()

    ok(f"Created {created} assignments across {len(audio_files)} files")


async def populate_all():
    section("Full Population  (steps 1 → 3 in sequence)")
    await create_annotators()
    await import_audio_files()
    await create_assignments()
    print()
    ok("All done!")


async def reset_database():
    section("Reset Database")
    confirm = input("  ⚠  This deletes ALL data except admin. Type 'yes' to confirm: ").strip()
    if confirm.lower() != "yes":
        info("Cancelled.")
        return

    async with AsyncSessionLocal() as db:
        for table in (
            "audit_logs", "segment_edit_history", "final_annotations",
            "original_json_store", "transcription_segments", "speaker_segments",
            "assignments", "audio_files",
        ):
            await db.execute(sql_text(f"DELETE FROM {table}"))
        await db.execute(sql_text("DELETE FROM users WHERE role != 'admin'"))
        await db.commit()

    ok("Database reset — admin user preserved")


# ── menu ──────────────────────────────────────────────────────────────────────

MENU = [
    ("Create annotators  (annotator_1 … annotator_5)",  create_annotators),
    ("Import audio files from  data/",                   import_audio_files),
    ("Create random assignments",                        create_assignments),
    ("Populate ALL  (1 → 3 in sequence)",                populate_all),
    ("Reset database  (keep admin only)",                 reset_database),
]


def print_menu():
    print()
    hr("═")
    print("  AudioAnnotator  ·  DB Tools")
    hr("═")
    for i, (label, _) in enumerate(MENU, 1):
        print(f"  {i}.  {label}")
    print("  0.  Exit")
    hr("═")


async def main():
    print("\n  AudioAnnotator DB Tools")
    info(f"data/   →  {DATA_DIR}")
    info(f"uploads →  {Path(settings.upload_dir).resolve()}")

    while True:
        print_menu()
        choice = input("  Select: ").strip()
        if choice == "0":
            print("  Goodbye!\n")
            break
        if choice.isdigit() and 1 <= int(choice) <= len(MENU):
            label, fn = MENU[int(choice) - 1]
            try:
                await fn()
            except Exception as exc:
                err(f"{exc}")
        else:
            info("Invalid choice — enter a number from the menu.")


if __name__ == "__main__":
    asyncio.run(main())
