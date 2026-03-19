"""
Emotion tier resolution service.
Shared by review.py (for display) and assignments.py (for auto-finalization).
"""
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.models import AudioFile, FinalAnnotation, SpeakerSegment, User
from app.services.trust_score import compute_new_trust_score


def compute_tier(annotations: list[dict]) -> dict:
    """
    3-tier emotion resolution using weighted trust scores.

    Tier 1: unanimous agreement across all annotators → confidence = 1.0
    Tier 2: weighted confidence of winning label >= 0.65 → auto-suggest
    Tier 3: < 0.65 → requires manual admin review

    annotations: list of {emotion, trust_score, annotator_id, ...}
    Returns: {tier: 1|2|3, winning_label: str|None, confidence: float}
    """
    if not annotations:
        return {"tier": 3, "winning_label": None, "confidence": 0.0}

    total_trust = sum(a["trust_score"] for a in annotations) or len(annotations)

    label_scores: dict[str, float] = {}
    for a in annotations:
        label = a["emotion"] or "Neutral"
        weight = a["trust_score"] if a["trust_score"] else 1.0
        label_scores[label] = label_scores.get(label, 0.0) + weight

    best_label = max(label_scores, key=lambda k: label_scores[k])
    confidence = label_scores[best_label] / total_trust

    unique = {a["emotion"] for a in annotations}
    if len(unique) == 1:
        return {"tier": 1, "winning_label": best_label, "confidence": 1.0}
    if confidence >= 0.65:
        return {"tier": 2, "winning_label": best_label, "confidence": round(confidence, 3)}
    return {"tier": 3, "winning_label": best_label, "confidence": round(confidence, 3)}


async def auto_finalize_emotions(db: AsyncSession, file_id: int, finalized_by: int) -> int:
    """
    Run after all emotion annotators complete for a file.
    Auto-creates FinalAnnotation rows for Tier 1 and Tier 2 segments.
    Returns the number of segments auto-resolved.
    """
    # Baseline segments
    baseline = (await db.execute(
        select(SpeakerSegment)
        .where(SpeakerSegment.audio_file_id == file_id)
        .where(SpeakerSegment.source == "pre_annotated")
        .order_by(SpeakerSegment.start_time)
    )).scalars().all()

    if not baseline:
        return 0

    # Annotator copies with user trust scores
    ann_rows = (await db.execute(
        select(SpeakerSegment, User.trust_score)
        .join(User, SpeakerSegment.annotator_id == User.id)
        .where(SpeakerSegment.audio_file_id == file_id)
        .where(SpeakerSegment.source == "annotator")
    )).all()

    # Map (start, end) → annotations list
    seg_map: dict[tuple, list] = {}
    for seg, trust in ann_rows:
        key = (round(seg.start_time, 3), round(seg.end_time, 3))
        seg_map.setdefault(key, []).append({
            "emotion": seg.emotion,
            "trust_score": trust,
            "annotator_id": seg.annotator_id,
        })

    # Existing final annotations (don't overwrite manual decisions)
    existing_ids: set[int] = {
        fa.segment_id
        for fa in (await db.execute(
            select(FinalAnnotation)
            .where(FinalAnnotation.audio_file_id == file_id)
            .where(FinalAnnotation.annotation_type == "emotion")
        )).scalars().all()
        if fa.segment_id is not None
    }

    now = datetime.now(timezone.utc)
    auto_resolved = 0

    # Track per-annotator agreement for trust score updates.
    # Structure: {annotator_id: {"agreements": int, "batch_size": int}}
    annotator_stats: dict[int, dict] = {}

    for seg in baseline:
        if seg.id in existing_ids:
            continue  # already decided manually — skip, don't double-count

        key = (round(seg.start_time, 3), round(seg.end_time, 3))
        annotations = seg_map.get(key, [])
        tier_info = compute_tier(annotations)

        if tier_info["tier"] <= 2 and tier_info["winning_label"]:
            method = "unanimous" if tier_info["tier"] == 1 else "weighted"
            db.add(FinalAnnotation(
                audio_file_id=file_id,
                segment_id=seg.id,
                annotation_type="emotion",
                data={"emotion": tier_info["winning_label"]},
                decision_method=method,
                finalized_by=finalized_by,
                finalized_at=now,
            ))
            auto_resolved += 1

            # Accumulate agreement stats for each annotator who voted on this segment.
            # Annotators who left emotion=None are excluded (no opinion, not penalised).
            winning = tier_info["winning_label"]
            for ann in annotations:
                if ann["emotion"] is None:
                    continue
                aid = ann["annotator_id"]
                if aid not in annotator_stats:
                    annotator_stats[aid] = {"agreements": 0, "batch_size": 0}
                annotator_stats[aid]["batch_size"] += 1
                if ann["emotion"] == winning:
                    annotator_stats[aid]["agreements"] += 1

    if auto_resolved:
        await db.flush()

    # ── Trust score updates ────────────────────────────────────────────────
    if annotator_stats:
        users = (await db.execute(
            select(User).where(User.id.in_(annotator_stats.keys()))
        )).scalars().all()

        for user in users:
            stats = annotator_stats[user.id]
            if stats["batch_size"] == 0:
                continue
            user.trust_score = compute_new_trust_score(
                current_score=user.trust_score,
                segments_reviewed=user.segments_reviewed,
                agreements_in_batch=stats["agreements"],
                batch_size=stats["batch_size"],
            )
            user.segments_reviewed += stats["batch_size"]

        await db.flush()

    return auto_resolved
