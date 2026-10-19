"""
acdd.core.llm
=============

Local inference clients for the ACDD engine: text **embeddings** (used to index
and search capabilities in the vector router) and **generation** (used by the
Markdown compiler and the docs-to-code extractor).

Both are defined behind abstract base classes so no cloud-only client leaks into
the core. The default concrete implementations target a local **Ollama** daemon;
swapping in another local/self-hosted backend is a matter of subclassing the ABC
and pointing the factories at it — the rest of the system is unaffected.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

from .http_client import HttpError, post_json

if TYPE_CHECKING:
    from .config import AcddConfig

logger = logging.getLogger("acdd.llm")

__all__ = [
    "EmbeddingError",
    "LLMError",
    "EmbeddingClient",
    "LLMClient",
    "OllamaEmbeddingClient",
    "OllamaLLMClient",
    "build_embedding_client",
    "build_llm_client",
]


class EmbeddingError(RuntimeError):
    """Raised when an embedding could not be produced."""


class LLMError(RuntimeError):
    """Raised when a generation call fails or returns an unusable result."""


class EmbeddingClient(ABC):
    """Abstract embedding provider. Implementations must be local by default."""

    @abstractmethod
    def embed(self, text: str) -> list[float]:
        """Return the embedding vector for ``text``. Raises :class:`EmbeddingError`."""


class LLMClient(ABC):
    """Abstract text-generation provider."""

    @abstractmethod
    def generate(self, prompt: str, *, system: str | None = None, temperature: float = 0.1) -> str:
        """Return the model completion for ``prompt``. Raises :class:`LLMError`."""


class OllamaEmbeddingClient(EmbeddingClient):
    """Embeddings via a local Ollama server (``POST /api/embeddings``)."""

    def __init__(self, base_url: str, model: str, timeout: float = 30.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout

    def embed(self, text: str) -> list[float]:
        if not text or not text.strip():
            raise EmbeddingError("Cannot embed empty text.")
        try:
            response = post_json(
                f"{self._base_url}/api/embeddings",
                {"model": self._model, "prompt": text},
                timeout=self._timeout,
            )
        except HttpError as exc:
            raise EmbeddingError(
                f"Ollama embedding request failed for model {self._model!r}: {exc}"
            ) from exc

        vector = response.get("embedding")
        if not isinstance(vector, list) or not vector:
            raise EmbeddingError(
                f"Ollama returned no embedding for model {self._model!r}; "
                f"is the model pulled? Response keys: {sorted(response)}"
            )
        try:
            return [float(component) for component in vector]
        except (TypeError, ValueError) as exc:
            raise EmbeddingError("Ollama embedding contained non-numeric values.") from exc


class OllamaLLMClient(LLMClient):
    """Generation via a local Ollama server (``POST /api/generate``)."""

    def __init__(self, base_url: str, model: str, timeout: float = 120.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout

    def generate(self, prompt: str, *, system: str | None = None, temperature: float = 0.1) -> str:
        payload: dict[str, object] = {
            "model": self._model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": temperature},
        }
        if system:
            payload["system"] = system
        try:
            response = post_json(
                f"{self._base_url}/api/generate", payload, timeout=self._timeout
            )
        except HttpError as exc:
            raise LLMError(
                f"Ollama generation request failed for model {self._model!r}: {exc}"
            ) from exc

        text = response.get("response")
        if not isinstance(text, str) or not text.strip():
            raise LLMError(
                f"Ollama returned an empty completion for model {self._model!r}."
            )
        return text


def build_embedding_client(config: "AcddConfig") -> EmbeddingClient:
    """Construct the default (Ollama) embedding client from configuration."""
    return OllamaEmbeddingClient(
        base_url=config.ollama_base_url,
        model=config.embedding_model,
        timeout=config.embedding_timeout,
    )


def build_llm_client(config: "AcddConfig") -> LLMClient:
    """Construct the default (Ollama) generation client from configuration."""
    return OllamaLLMClient(
        base_url=config.ollama_base_url,
        model=config.llm_model,
        timeout=config.llm_timeout,
    )
