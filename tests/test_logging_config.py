from __future__ import annotations

import logging

from agents.logging_config import configure_agent_logging


class TestConfigureAgentLogging:
    def test_writes_rotating_file(self, tmp_path) -> None:
        logger = configure_agent_logging("test_agent", "test_agent.log", log_dir=str(tmp_path))
        logger.info("hello from test")
        for handler in logger.handlers:
            handler.flush()
        assert (tmp_path / "test_agent.log").exists()

    def test_uses_namespace_logger_name(self, tmp_path) -> None:
        logger = configure_agent_logging("agents.something", "x.log", log_dir=str(tmp_path))
        assert logger.name == "agents.something"

    def test_idempotent_no_duplicate_handlers(self, tmp_path) -> None:
        configure_agent_logging("test_idem", "y.log", log_dir=str(tmp_path))
        logger = configure_agent_logging("test_idem", "z.log", log_dir=str(tmp_path))
        assert len([h for h in logger.handlers]) == 1

    def test_isolated_per_logger(self, tmp_path) -> None:
        a_dir = tmp_path / "a"
        b_dir = tmp_path / "b"
        configure_agent_logging("test_a", "a.log", log_dir=str(a_dir))
        logger_b = configure_agent_logging("test_b", "b.log", log_dir=str(b_dir))
        assert len([h for h in logger_b.handlers]) == 1
        assert all("b.log" in str(h.baseFilename) for h in logger_b.handlers)

    def test_level_default_is_info(self, tmp_path) -> None:
        logger = configure_agent_logging("test_level", "level.log", log_dir=str(tmp_path))
        assert logger.level == logging.INFO
        for handler in logger.handlers:
            logger.removeHandler(handler)