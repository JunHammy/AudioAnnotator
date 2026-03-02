"""
Preprocessing applied to uploaded JSONs before seeding the database.

Rules:
- Speaker segments: rename speaker_0 → speaker_1 (shift all labels +1)
- Emotion labels: strip bias prefix (e.g. "surprised_occ4_" → store raw in DB,
  expose clean label to annotators via the response schema / frontend filter)
- Transcription: no structural changes, just store as-is
"""


def shift_speaker_labels(segments: list[dict]) -> list[dict]:
    """Increment every speaker_N label by 1 (speaker_0 → speaker_1, etc.)."""
    result = []
    for seg in segments:
        seg = seg.copy()
        label = seg.get("speaker_label") or seg.get("speaker", "")
        if label.startswith("speaker_"):
            try:
                n = int(label.split("_")[1])
                seg["speaker_label"] = f"speaker_{n + 1}"
            except (IndexError, ValueError):
                pass
        result.append(seg)
    return result


def strip_emotion_prefix(emotion: str | None) -> str | None:
    """
    Return cleaned emotion label for display.
    Raw value is stored in DB; this is only for frontend display.
    E.g. "surprised_occ4_" → "Surprised"
    """
    if not emotion:
        return emotion
    # Take the first word before '_' and capitalise
    base = emotion.split("_")[0].capitalize()
    return base


def preprocess_speaker_segments(raw: list[dict]) -> list[dict]:
    return shift_speaker_labels(raw)


def preprocess_transcription_segments(raw: list[dict]) -> list[dict]:
    return raw  # No structural changes needed at upload time
