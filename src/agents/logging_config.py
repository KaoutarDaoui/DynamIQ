from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]


def default_log_dir() -> Path:
    """Repo-root `logs/` directory, independent of the process CWD."""
    return _REPO_ROOT / "logs"


def configure_agent_logging(
    logger_name: str,
    log_file: str,
    log_dir: str | Path | None = None,
    level: int = logging.INFO,
    max_bytes: int = 5_000_000,
    backup_count: int = 3,
) -> logging.Logger:
    """Attach a rotating file handler to a namespace logger (e.g. the agent
    package) so that all `logging.getLogger(__name__)` children inherit it.

    Idempotent: calling twice returns the logger without adding a duplicate
    handler.
    """
    logger = logging.getLogger(logger_name)
    logger.setLevel(level)
    if logger.handlers:
        return logger
    log_dir = Path(log_dir) if log_dir else default_log_dir()
    log_path = log_dir / log_file
    log_path.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        str(log_path),
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(handler)
    return logger