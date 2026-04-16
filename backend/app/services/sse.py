import asyncio
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)


class SSEManager:
    """
    In-memory pub/sub for Server-Sent Events.

    Two channel types:
    - File channels  (keyed by audio_file_id) — segment create/update/delete, lock changes
    - User channels  (keyed by user_id)       — notifications, new assignments (app-wide)

    When a subscriber's queue is full (slow or disconnected client), the oldest
    event is dropped to make room for the newest one (sliding-window behaviour).
    This ensures clients always receive the most recent state rather than
    silently missing events with no indication.
    """

    def __init__(self) -> None:
        self._file_queues: dict[int, set[asyncio.Queue]] = defaultdict(set)
        self._user_queues: dict[int, set[asyncio.Queue]] = defaultdict(set)

    # ── Internal helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _put(q: asyncio.Queue, event: dict) -> None:
        """Put an event onto the queue, evicting the oldest entry if full."""
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            try:
                q.get_nowait()  # drop oldest
            except asyncio.QueueEmpty:
                pass
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("SSE queue still full after eviction — event dropped")

    # ── File channel ──────────────────────────────────────────────────────────

    def subscribe(self, file_id: int) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=50)
        self._file_queues[file_id].add(q)
        return q

    def unsubscribe(self, file_id: int, q: asyncio.Queue) -> None:
        self._file_queues[file_id].discard(q)

    async def broadcast(self, file_id: int, event: dict) -> None:
        """Push an event to every subscriber watching file_id."""
        for q in list(self._file_queues.get(file_id, [])):
            self._put(q, event)

    # ── User channel ──────────────────────────────────────────────────────────

    def subscribe_user(self, user_id: int) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=50)
        self._user_queues[user_id].add(q)
        return q

    def unsubscribe_user(self, user_id: int, q: asyncio.Queue) -> None:
        self._user_queues[user_id].discard(q)

    async def broadcast_user(self, user_id: int, event: dict) -> None:
        """Push an event to every session the given user has open."""
        for q in list(self._user_queues.get(user_id, [])):
            self._put(q, event)


sse_manager = SSEManager()
