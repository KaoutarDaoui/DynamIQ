from __future__ import annotations

import os
import sqlite3
from functools import lru_cache
from pathlib import Path

from langgraph.checkpoint.sqlite import SqliteSaver


def get_default_checkpoint_path() -> Path:
    env = os.getenv("DIAGNOSTIC_CHECKPOINT_DB")
    if env:
        return Path(env)
    return Path(os.getenv("DYNAMIQ_DATA_DIR", "data")) / "agent3_checkpoints.sqlite"


@lru_cache(maxsize=8)
def _cached(path: str) -> SqliteSaver:
    conn = sqlite3.connect(path, check_same_thread=False)
    saver = SqliteSaver(conn)
    saver.setup()
    return saver


def get_checkpointer(path: str | Path | None = None) -> SqliteSaver:
    """Persistent LangGraph checkpointer (sqlite file).

    Crash-safe: the state is saved after every node; a crashed investigation
    can be resumed from the same thread (see graph.resume_investigation).
    """
    checkpoint_path = Path(path) if path else get_default_checkpoint_path()
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    return _cached(str(checkpoint_path))
