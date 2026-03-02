#!/usr/bin/env python3
"""
dbTools.py — Developer database population tool.
Run from the backend/ directory with the venv activated:

    python dbTools.py

Expects audio/JSON files under:
    AudioAnnotator/data/<subfolder>/
        <name>.wav  (or .mp3)
        <name>_emotion.json      ← emotion + gender segments
        <name>_speaker.json      ← speaker diarization
        <name>_transcription.json
"""

import asyncio
import json
import random
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import delete, select, text as sql_text

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

EMOTIONS   = ["Neutral", "Happy", "Sad", "Angry", "Surprised", "Fear", "Disgust"]
GENDERS    = ["Male", "Female", "unk"]
LANGUAGES  = ["English", "Malay", "Chinese", "Tamil"]
TASK_TYPES = ["emotion", "gender", "speaker", "transcription"]
SAMPLE_TEXTS = [
    "Hello, how are you today?",
    "Let me explain this concept.",
    "I understand what you mean.",
    "Could you repeat that please?",
    "That is a very interesting point.",
    "I agree with your assessment.",
    "We need to discuss this further.",
    "Thank you for your patience.",
    "Can we go over that again?",
    "That sounds about right.",
]

# ── helpers ───────────────────────────────────────────────────────────────────

def hr(char="─", width=54):
    print(char * width)

def section(title: str):
    print()
    hr()
    print(f"  {title}")
    hr()

def ok(msg):  print(f"  ✓  {msg}")
def skip(msg): print(f"  ~  {msg}")
def err(msg):  print(f"  ✗  {msg}")
def info(msg): print(f"  ·  {msg}")

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

    if not DATA_DIR.exists():
        err(f"data/ not found at {DATA_DIR}")
        info("Create  AudioAnnotator/data/<subfolder>/  and add your files there.")
        return

    upload_dir = Path(settings.upload_dir)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.role == "admin").limit(1))
        admin = result.scalar_one_or_none()
        if not admin:
            err("No admin user found — run seed.py first.")
            return

        imported = skipped = 0

        for folder in sorted(f for f in DATA_DIR.iterdir() if f.is_dir()):
            subfolder = folder.name
            dest_dir  = upload_dir / subfolder
            dest_dir.mkdir(parents=True, exist_ok=True)

            audio_files = sorted(
                f for f in folder.iterdir()
                if f.suffix.lower() in (".wav", ".mp3")
                and not any(tag in f.stem for tag in ("_emotion", "_speaker", "_transcription"))
            )

            for audio in audio_files:
                result = await db.execute(
                    select(AudioFile).where(AudioFile.filename == audio.name)
                )
                if result.scalar_one_or_none():
                    skipped += 1
                    continue

                base = audio.stem
                emotion_path       = folder / f"{base}_emotion.json"
                speaker_path       = folder / f"{base}_speaker.json"
                transcription_path = folder / f"{base}_transcription.json"

                # Copy audio to uploads/
                dest_file = dest_dir / audio.name
                if not dest_file.exists():
                    shutil.copy2(audio, dest_file)

                # Parse speaker count + duration from speaker JSON if available
                num_speakers = random.randint(1, 4)
                duration     = random.uniform(10.0, 60.0)
                language     = random.choice(LANGUAGES)

                if speaker_path.exists():
                    try:
                        data = json.loads(speaker_path.read_text(encoding="utf-8"))
                        segs = data.get("segments", data.get("speaker_segments", []))
                        speakers = {
                            s.get("speaker", s.get("speaker_label", "")) for s in segs
                        }
                        num_speakers = max(len(speakers), 1)
                        if segs:
                            duration = max(
                                s.get("end", s.get("end_time", 0)) for s in segs
                            )
                    except Exception:
                        pass

                af = AudioFile(
                    filename=audio.name,
                    subfolder=subfolder,
                    duration=round(duration, 2),
                    language=language,
                    num_speakers=num_speakers,
                    file_path=str(dest_file),
                    uploaded_by=admin.id,
                )
                db.add(af)
                await db.flush()

                # Store original JSONs verbatim
                for json_path, json_type in (
                    (emotion_path,       "emotion_gender"),
                    (speaker_path,       "speaker"),
                    (transcription_path, "transcription"),
                ):
                    if json_path.exists():
                        try:
                            data = json.loads(json_path.read_text(encoding="utf-8"))
                            db.add(OriginalJSONStore(
                                audio_file_id=af.id,
                                json_type=json_type,
                                data=data,
                            ))
                        except Exception:
                            pass

                info(f"+ {subfolder}/{audio.name}  ({num_speakers} spk, {duration:.1f}s, {language})")
                imported += 1

        await db.commit()

    print()
    ok(f"Imported {imported} files  ({skipped} already existed)")


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

        created = 0
        for af in audio_files:
            # Emotion: 2-3 independent annotators
            emotion_pool = random.sample(annotators, min(random.randint(2, 3), len(annotators)))
            for ann in emotion_pool:
                db.add(Assignment(
                    audio_file_id=af.id,
                    annotator_id=ann.id,
                    task_type="emotion",
                    status=random.choice(["pending", "in_progress", "completed"]),
                ))
                created += 1

            # Collaborative tasks: one annotator each
            for task_type in ("gender", "speaker", "transcription"):
                db.add(Assignment(
                    audio_file_id=af.id,
                    annotator_id=random.choice(annotators).id,
                    task_type=task_type,
                    status=random.choice(["pending", "in_progress", "completed"]),
                ))
                created += 1

        await db.commit()

    ok(f"Created {created} assignments across {len(audio_files)} files")


async def create_dummy_segments():
    section("Generate Dummy Segments")

    async with AsyncSessionLocal() as db:
        audio_files = (await db.execute(select(AudioFile))).scalars().all()
        annotators  = (
            await db.execute(select(User).where(User.role == "annotator"))
        ).scalars().all()

        if not audio_files or not annotators:
            err("Need audio files and annotators first.")
            return

        seg_count = 0
        for af in audio_files:
            duration = af.duration or 30.0
            n        = random.randint(4, 10)
            # Build non-overlapping random time windows
            times    = sorted(random.uniform(0, duration) for _ in range(n * 2))
            windows  = [(times[i * 2], times[i * 2 + 1]) for i in range(n)]
            labels   = [f"speaker_{i + 1}" for i in range(max(af.num_speakers or 2, 1))]
            ann      = random.choice(annotators)

            for start, end in windows:
                if end - start < 0.3:
                    continue
                db.add(SpeakerSegment(
                    audio_file_id=af.id,
                    annotator_id=ann.id,
                    speaker_label=random.choice(labels),
                    start_time=round(start, 3),
                    end_time=round(end, 3),
                    gender=random.choice(GENDERS),
                    emotion=random.choice(EMOTIONS),
                    is_ambiguous=random.random() < 0.1,
                    source="original",
                ))
                db.add(TranscriptionSegment(
                    audio_file_id=af.id,
                    annotator_id=ann.id,
                    start_time=round(start, 3),
                    end_time=round(end, 3),
                    original_text=random.choice(SAMPLE_TEXTS),
                ))
                seg_count += 1

        await db.commit()

    ok(f"Created {seg_count} segment pairs (speaker + transcription)")


async def populate_all():
    section("Full Population  (steps 1 → 4)")
    await create_annotators()
    await import_audio_files()
    await create_assignments()
    await create_dummy_segments()
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
    ("Generate dummy segments",                          create_dummy_segments),
    ("Populate ALL  (1 → 4 in sequence)",                populate_all),
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
