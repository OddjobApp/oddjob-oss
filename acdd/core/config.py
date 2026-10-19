"""
acdd.core.config
================

Environment-driven configuration for the ACDD engine.

All tunables are read once from the process environment and exposed as a frozen,
strongly-typed :class:`AcddConfig`. Defaults target a fully local/private runtime
(a registry on ``localhost:8080`` and Ollama on ``localhost:11434``) so the system
runs out-of-the-box with no cloud credentials.

Environment variables
----------------------
=============================  ================================================
Variable                       Purpose (default)
=============================  ================================================
ACDD_REGISTRY_HOST             Registry bind host (``127.0.0.1``)
ACDD_REGISTRY_PORT             Registry bind port (``8080``)
ACDD_OLLAMA_BASE_URL           Ollama base URL (``http://localhost:11434``)
ACDD_EMBEDDING_MODEL           Ollama embedding model (``nomic-embed-text``)
ACDD_EMBEDDING_TIMEOUT         Embedding HTTP timeout, seconds (``30``)
ACDD_LLM_MODEL                 Ollama chat/generate model (``llama3.1``)
ACDD_LLM_TIMEOUT               LLM HTTP timeout, seconds (``120``)
ACDD_VECTOR_BACKEND            ``memory`` | ``chroma`` (``memory``)
ACDD_CHROMA_PATH               Persist dir for Chroma (``.acdd/chroma``)
ACDD_DISCOVER_TOP_K            Default results returned by /discover (``3``)
ACDD_DOCS_REPO_PATH            Git repo root docs are written into (``.``)
ACDD_DOCS_SUBDIR               Doc dir under the repo (``docs/capabilities``)
ACDD_GIT_DOCS_BRANCH           Branch for Low/Medium docs (``main``)
ACDD_GIT_REMOTE                Remote name to push to (``origin``)
ACDD_GIT_AUTHOR_NAME           Commit author name (``ACDD Bot``)
ACDD_GIT_AUTHOR_EMAIL          Commit author email (``acdd-bot@oddjob.local``)
ACDD_GIT_AUTO_PUSH             Push after commit, ``1``/``0`` (``1``)
ACDD_REGISTER_TIMEOUT          Decorator fire-and-forget timeout, s (``2``)
ACDD_WIRE_DOCS                 Auto-run doc+git pipeline on register (``0``)
=============================  ================================================
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

__all__ = ["AcddConfig", "get_config", "reset_config_cache"]


def _env_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value is not None and value != "" else default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True, slots=True)
class AcddConfig:
    """Immutable snapshot of ACDD configuration."""

    registry_host: str
    registry_port: int
    ollama_base_url: str
    embedding_model: str
    embedding_timeout: float
    llm_model: str
    llm_timeout: float
    vector_backend: str
    chroma_path: str
    discover_top_k: int
    docs_repo_path: Path
    docs_subdir: str
    git_docs_branch: str
    git_remote: str
    git_author_name: str
    git_author_email: str
    git_auto_push: bool
    register_timeout: float
    wire_docs: bool

    # --- Derived endpoint helpers -----------------------------------------
    register_path: str = "/api/v1/registry/register"
    discover_path: str = "/api/v1/registry/discover"
    health_path: str = "/api/v1/registry/health"

    @property
    def registry_base_url(self) -> str:
        return f"http://{self.registry_host}:{self.registry_port}"

    @property
    def register_url(self) -> str:
        return f"{self.registry_base_url}{self.register_path}"

    @property
    def discover_url(self) -> str:
        return f"{self.registry_base_url}{self.discover_path}"

    @property
    def docs_dir(self) -> Path:
        """Absolute directory capability docs are written into."""
        return (self.docs_repo_path / self.docs_subdir).resolve()


@lru_cache(maxsize=1)
def get_config() -> AcddConfig:
    """Build (and cache) the configuration from the current environment."""
    return AcddConfig(
        registry_host=_env_str("ACDD_REGISTRY_HOST", "127.0.0.1"),
        registry_port=_env_int("ACDD_REGISTRY_PORT", 8080),
        ollama_base_url=_env_str("ACDD_OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/"),
        embedding_model=_env_str("ACDD_EMBEDDING_MODEL", "nomic-embed-text"),
        embedding_timeout=_env_float("ACDD_EMBEDDING_TIMEOUT", 30.0),
        llm_model=_env_str("ACDD_LLM_MODEL", "llama3.1"),
        llm_timeout=_env_float("ACDD_LLM_TIMEOUT", 120.0),
        vector_backend=_env_str("ACDD_VECTOR_BACKEND", "memory").strip().lower(),
        chroma_path=_env_str("ACDD_CHROMA_PATH", ".acdd/chroma"),
        discover_top_k=_env_int("ACDD_DISCOVER_TOP_K", 3),
        docs_repo_path=Path(_env_str("ACDD_DOCS_REPO_PATH", ".")).resolve(),
        docs_subdir=_env_str("ACDD_DOCS_SUBDIR", "docs/capabilities"),
        git_docs_branch=_env_str("ACDD_GIT_DOCS_BRANCH", "main"),
        git_remote=_env_str("ACDD_GIT_REMOTE", "origin"),
        git_author_name=_env_str("ACDD_GIT_AUTHOR_NAME", "ACDD Bot"),
        git_author_email=_env_str("ACDD_GIT_AUTHOR_EMAIL", "acdd-bot@oddjob.local"),
        git_auto_push=_env_bool("ACDD_GIT_AUTO_PUSH", True),
        register_timeout=_env_float("ACDD_REGISTER_TIMEOUT", 2.0),
        wire_docs=_env_bool("ACDD_WIRE_DOCS", False),
    )


def reset_config_cache() -> None:
    """Clear the cached config. Primarily for tests that mutate the environment."""
    get_config.cache_clear()
