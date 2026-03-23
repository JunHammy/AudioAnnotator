import asyncio
from collections import defaultdict


class SSEManager:
    """
    In-memory pub/sub for Server-Sent Events.

    Two channel types:
    - File channels  (keyed by audio_file_id) — segment create/update/delete, lock changes
    - User channels  (keyed by user_id)       — notifications, new assignments (app-wide)
    """

    def __init__(self) -> None:
        self._file_queues: dict[int, set[asyncio.Queue]] = defaultdict(set)
        self._user_queues: dict[int, set[asyncio.Queue]] = defaultdict(set)

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
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass

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
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass


sse_manager = SSEManager()
