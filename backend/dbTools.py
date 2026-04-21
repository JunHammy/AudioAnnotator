#!/usr/bin/env python3
"""
dbTools.py — Developer database population tool.
Run from the backend/ directory with the venv activated:

    python dbTools.py

Supported data layouts under AudioAnnotator/data/:

  ── Dataset / subfolder layout (recommended) ────────────────────────────────
  data/
      <dataset_name>/
          audio/           <name>.wav   (or .mp3)
          emotion_gender/  <name>.json
          speaker/         <name>.json
          transcription/   <name>.json

  ── Flat layout (legacy / quick use) ────────────────────────────────────────
  data/
      audio/           <name>.wav   (or .mp3)
      emotion_gender/  <name>.json
      speaker/         <name>.json
      transcription/   <name>.json

The tool auto-detects which layout is present.
In the flat layout you are prompted to optionally assign files to a dataset.
Audio files are stored flat in uploads/ regardless of layout.
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
    Dataset,
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
    """Pass speaker_N labels through unchanged (already 0-based)."""
    if not label:
        return label
    lower = label.lower()
    if lower.startswith("speaker_"):
        try:
            n = int(lower.split("_", 1)[1])
            return f"speaker_{n}"
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
    predictions = data.get("predictions", {})
    windows = []
    for entry in predictions.values():
        windows.append({
            "start_time": float(entry.get("start_time", 0)),
            "end_time":   float(entry.get("end_time",   0)),
            "gender":     entry.get("gender", "unk").title(),
            "emotion":    entry.get("emotion", "").title(),
        })
    return sorted(windows, key=lambda w: w["start_time"])


def _parse_transcription_json(data: dict) -> list:
    return [
        {
            "start_time": float(t["start_time"]),
            "end_time":   float(t["end_time"]),
            "text":       t.get("text", ""),
        }
        for t in data.get("texts", [])
    ]


def _detect_dataset_subfolders() -> list[Path]:
    """
    Return subdirectories under data/ that look like dataset folders
    (i.e., they contain an audio/ sub-directory with audio files).
    """
    if not DATA_DIR.exists():
        return []
    result = []
    for entry in sorted(DATA_DIR.iterdir()):
        if entry.is_dir() and entry.name not in ("audio", "emotion_gender", "speaker", "transcription"):
            audio_sub = entry / "audio"
            if audio_sub.exists() and any(audio_sub.glob("*.wav")) or any(audio_sub.glob("*.mp3")) if audio_sub.exists() else False:
                result.append(entry)
    return result


async def _get_or_create_dataset(db, name: str, admin_id: int) -> Dataset:
    """Return existing dataset by name, or create it."""
    result = await db.execute(select(Dataset).where(Dataset.name == name))
    ds = result.scalar_one_or_none()
    if not ds:
        ds = Dataset(name=name, created_by=admin_id)
        db.add(ds)
        await db.flush()
        info(f"Created dataset: {name}")
    else:
        info(f"Using existing dataset: {name}")
    return ds


async def _import_folder(db, audio_dir: Path, emo_dir: Path, speaker_dir: Path, trans_dir: Path,
                          admin, dataset_id: int | None, upload_dir: Path) -> tuple[int, int]:
    """Import all audio files from a single folder set. Returns (imported, skipped)."""
    if not audio_dir.exists():
        err(f"audio/ not found at {audio_dir}")
        return 0, 0

    imported = skipped = 0

    for audio in sorted(f for f in audio_dir.iterdir() if f.suffix.lower() in (".wav", ".mp3")):
        result = await db.execute(select(AudioFile).where(AudioFile.filename == audio.name))
        if result.scalar_one_or_none():
            skipped += 1
            continue

        stem = audio.stem

        speaker_path = speaker_dir / f"{stem}.json"
        emo_path     = emo_dir     / f"{stem}.json"
        trans_path   = trans_dir   / f"{stem}.json"

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

        upload_dir.mkdir(parents=True, exist_ok=True)
        dest_file = upload_dir / audio.name
        if not dest_file.exists():
            shutil.copy2(audio, dest_file)

        af = AudioFile(
            filename=audio.name,
            dataset_id=dataset_id,
            duration=round(duration, 2),
            language=language,
            num_speakers=num_speakers,
            file_path=str(dest_file),
            uploaded_by=admin.id,
        )
        db.add(af)
        await db.flush()

        for raw, json_type in (
            (emo_data,   "emotion_gender"),
            (spk_data,   "speaker"),
            (trans_data, "transcription"),
        ):
            if raw is not None:
                db.add(OriginalJSONStore(audio_file_id=af.id, json_type=json_type, data=raw))

        for s in spk_segs:
            win = _overlapping_window(s["start_time"], s["end_time"], emo_windows)
            db.add(SpeakerSegment(
                audio_file_id=af.id,
                annotator_id=admin.id,
                speaker_label=s["speaker_label"],
                start_time=round(s["start_time"], 3),
                end_time=round(s["end_time"], 3),
                gender=win["gender"] if win else "unk",
                emotion=win["emotion"] if win else None,
                source="pre_annotated",
            ))

        for t in trans_segs:
            db.add(TranscriptionSegment(
                audio_file_id=af.id,
                annotator_id=admin.id,
                start_time=round(t["start_time"], 3),
                end_time=round(t["end_time"], 3),
                original_text=t["text"],
            ))

        info(
            f"  + {audio.name}  ({num_speakers} spk, {duration:.1f}s, {language})"
            f"  →  {len(spk_segs)} spk segs, {len(trans_segs)} trn segs"
        )
        imported += 1

    return imported, skipped


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


async def create_dataset_interactive():
    section("Create Dataset")
    name = input("  Dataset name: ").strip()
    if not name:
        info("Cancelled — no name entered.")
        return
    description = input("  Description (optional): ").strip() or None

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.role == "admin").limit(1))
        admin = result.scalar_one_or_none()
        if not admin:
            err("No admin user found — run seed.py first.")
            return

        existing = await db.execute(select(Dataset).where(Dataset.name == name))
        if existing.scalar_one_or_none():
            err(f"Dataset '{name}' already exists.")
            return

        ds = Dataset(name=name, description=description, created_by=admin.id)
        db.add(ds)
        await db.commit()
        await db.refresh(ds)

    ok(f"Dataset '{name}' created  (id={ds.id})")


async def list_datasets_info():
    section("Existing Datasets")
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Dataset).order_by(Dataset.created_at))
        datasets = result.scalars().all()
        if not datasets:
            info("No datasets yet.")
            return
        for ds in datasets:
            count_res = await db.execute(
                select(AudioFile).where(AudioFile.dataset_id == ds.id)
            )
            count = len(count_res.scalars().all())
            info(f"[{ds.id}] {ds.name}  —  {count} file(s)")


async def import_audio_files():
    section("Import Audio Files from data/")

    upload_dir = Path(settings.upload_dir)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.role == "admin").limit(1))
        admin = result.scalar_one_or_none()
        if not admin:
            err("No admin user found — run seed.py first.")
            return

        # ── Detect layout ────────────────────────────────────────────────────
        dataset_subdirs = _detect_dataset_subfolders()

        if dataset_subdirs:
            # ── Subfolder / dataset layout ───────────────────────────────────
            info(f"Detected {len(dataset_subdirs)} dataset subfolder(s) under data/:")
            for d in dataset_subdirs:
                info(f"  · {d.name}/")
            print()

            total_imported = total_skipped = 0
            for subdir in dataset_subdirs:
                ds = await _get_or_create_dataset(db, subdir.name, admin.id)
                imported, skipped = await _import_folder(
                    db,
                    audio_dir   = subdir / "audio",
                    emo_dir     = subdir / "emotion_gender",
                    speaker_dir = subdir / "speaker",
                    trans_dir   = subdir / "transcription",
                    admin       = admin,
                    dataset_id  = ds.id,
                    upload_dir  = upload_dir,
                )
                total_imported += imported
                total_skipped  += skipped
                ok(f"  {subdir.name}: {imported} imported, {skipped} skipped")

            await db.commit()
            print()
            ok(f"Total: {total_imported} imported, {total_skipped} already existed")

        else:
            # ── Flat layout ──────────────────────────────────────────────────
            audio_dir   = DATA_DIR / "audio"
            emo_dir     = DATA_DIR / "emotion_gender"
            speaker_dir = DATA_DIR / "speaker"
            trans_dir   = DATA_DIR / "transcription"

            if not audio_dir.exists():
                err(f"data/audio/ not found at {audio_dir}")
                info("Flat layout:     AudioAnnotator/data/audio/<files>")
                info("Dataset layout:  AudioAnnotator/data/<dataset_name>/audio/<files>")
                return

            info("Flat layout detected (data/audio/).")

            # Show existing datasets and ask whether to assign
            ds_result = await db.execute(select(Dataset).order_by(Dataset.name))
            existing_datasets = ds_result.scalars().all()

            dataset_id = None
            if existing_datasets:
                print()
                print("  Existing datasets:")
                for ds in existing_datasets:
                    print(f"    [{ds.id}] {ds.name}")
                print()
                choice = input(
                    "  Assign imported files to a dataset?\n"
                    "  Enter dataset ID, a new name, or leave blank to skip: "
                ).strip()

                if choice:
                    if choice.isdigit():
                        ds_check = await db.execute(select(Dataset).where(Dataset.id == int(choice)))
                        chosen = ds_check.scalar_one_or_none()
                        if chosen:
                            dataset_id = chosen.id
                            info(f"Assigning to dataset: {chosen.name}")
                        else:
                            err(f"Dataset ID {choice} not found.")
                            return
                    else:
                        ds = await _get_or_create_dataset(db, choice, admin.id)
                        dataset_id = ds.id
            else:
                print()
                choice = input(
                    "  No datasets exist yet.\n"
                    "  Enter a dataset name to create and assign to, or leave blank to skip: "
                ).strip()
                if choice:
                    ds = await _get_or_create_dataset(db, choice, admin.id)
                    dataset_id = ds.id

            print()
            imported, skipped = await _import_folder(
                db,
                audio_dir=audio_dir, emo_dir=emo_dir,
                speaker_dir=speaker_dir, trans_dir=trans_dir,
                admin=admin, dataset_id=dataset_id,
                upload_dir=upload_dir,
            )
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

        existing = set()
        for row in (await db.execute(select(Assignment))).scalars().all():
            existing.add((row.audio_file_id, row.annotator_id, row.task_type))

        created = 0
        for af in audio_files:
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
            "assignments", "audio_files", "datasets",
        ):
            await db.execute(sql_text(f"DELETE FROM {table}"))
        await db.execute(sql_text("DELETE FROM users WHERE role != 'admin'"))
        await db.commit()

    ok("Database reset — admin user preserved")


# ── menu ──────────────────────────────────────────────────────────────────────

MENU = [
    ("Create annotators  (annotator_1 … annotator_5)",  create_annotators),
    ("Create a dataset",                                 create_dataset_interactive),
    ("List existing datasets",                           list_datasets_info),
    ("Import audio files from  data/",                   import_audio_files),
    ("Create random assignments",                        create_assignments),
    ("Populate ALL  (annotators → import → assignments)", populate_all),
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
