"""
Trust score calculation for emotion annotation.

Rolling 200-segment window. Floor 0.20, ceiling 1.00.
Only applied after finalization of emotion task.
"""

WINDOW = 200
FLOOR = 0.20
CEILING = 1.00
INITIAL = 0.50


def compute_new_trust_score(
    current_score: float,
    segments_reviewed: int,
    agreements_in_batch: int,
    batch_size: int,
) -> float:
    """
    Weighted update: blend existing score with batch accuracy.
    Weight of existing score is proportional to how full the window is.
    """
    filled = min(segments_reviewed, WINDOW)
    batch_accuracy = agreements_in_batch / batch_size if batch_size > 0 else 0.0

    # Weighted average: existing contributes (filled / WINDOW), batch contributes (batch / WINDOW)
    new_score = (current_score * filled + batch_accuracy * batch_size) / (filled + batch_size)
    return max(FLOOR, min(CEILING, new_score))
