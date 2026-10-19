"""
acdd.core.registry
==================

The live capability router: a vector-indexed registry that both pipeline
directions converge on.

* **Code → Docs** registers a freshly-reflected manifest here so the router
  always reflects the current code.
* **Docs → Code** registers manifests extracted from Markdown so hand-written
  documentation can introduce or amend a capability.
* Agents call :meth:`CapabilityRegistry.discover` with a natural-language problem
  and receive the top-K structural manifests to inject into their context.

The vector store sits behind an abstract :class:`VectorBackend`. The default is a
dependency-free in-memory cosine index (perfect for local/private runtimes and
tests); an optional Chroma backend is provided and imported lazily so it is only
required when explicitly selected.
"""

from __future__ import annotations

import logging
import math
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Callable

from .config import AcddConfig, get_config
from .llm import EmbeddingClient, build_embedding_client
from .schema import CapabilityManifest, ManifestValidationError, validate_manifest

logger = logging.getLogger("acdd.registry")

__all__ = [
    "SearchHit",
    "DiscoveryResult",
    "VectorBackend",
    "InMemoryVectorBackend",
    "ChromaVectorBackend",
    "CapabilityRegistry",
    "build_vector_backend",
    "build_registry",
]

# Callback invoked after a successful registration (used to wire the doc pipeline).
RegisteredCallback = Callable[[CapabilityManifest], None]


@dataclass(frozen=True, slots=True)
class SearchHit:
    """A raw vector-store match."""

    capability_id: str
    score: float
    payload: dict[str, Any]


@dataclass(frozen=True, slots=True)
class DiscoveryResult:
    """A discovery match surfaced to an agent."""

    capability_id: str
    score: float
    manifest: dict[str, Any]


class VectorBackend(ABC):
    """Pluggable vector store. Implementations must be local-first."""

    @abstractmethod
    def upsert(self, capability_id: str, vector: list[float], payload: dict[str, Any]) -> None:
        ...

    @abstractmethod
    def query(self, vector: list[float], top_k: int) -> list[SearchHit]:
        ...

    @abstractmethod
    def delete(self, capability_id: str) -> None:
        ...

    @abstractmethod
    def ids(self) -> list[str]:
        ...

    def __len__(self) -> int:  # pragma: no cover - trivial
        return len(self.ids())


class InMemoryVectorBackend(VectorBackend):
    """Dependency-free cosine-similarity index.

    Suitable for single-process local runtimes and tests. Cosine similarity is
    computed in pure Python so the core has no numpy/vector-DB dependency.
    """

    def __init__(self) -> None:
        # capability_id -> (vector, norm, payload)
        self._store: dict[str, tuple[list[float], float, dict[str, Any]]] = {}

    @staticmethod
    def _norm(vector: list[float]) -> float:
        return math.sqrt(sum(component * component for component in vector)) or 1.0

    def upsert(self, capability_id: str, vector: list[float], payload: dict[str, Any]) -> None:
        self._store[capability_id] = (vector, self._norm(vector), payload)

    def query(self, vector: list[float], top_k: int) -> list[SearchHit]:
        if not self._store:
            return []
        query_norm = self._norm(vector)
        hits: list[SearchHit] = []
        for capability_id, (stored_vector, stored_norm, payload) in self._store.items():
            if len(stored_vector) != len(vector):
                # Dimension mismatch means the vectors came from different
                # embedding models; skip rather than raise so one stale entry
                # cannot break the whole query.
                logger.warning(
                    "Skipping %s: vector dim %d != query dim %d",
                    capability_id,
                    len(stored_vector),
                    len(vector),
                )
                continue
            dot = sum(a * b for a, b in zip(stored_vector, vector))
            score = dot / (stored_norm * query_norm)
            hits.append(SearchHit(capability_id=capability_id, score=score, payload=payload))
        hits.sort(key=lambda hit: hit.score, reverse=True)
        return hits[: max(0, top_k)]

    def delete(self, capability_id: str) -> None:
        self._store.pop(capability_id, None)

    def ids(self) -> list[str]:
        return list(self._store.keys())


class ChromaVectorBackend(VectorBackend):
    """Optional persistent backend using a local ChromaDB collection.

    ``chromadb`` is imported lazily so it is only a dependency when the
    ``chroma`` backend is explicitly configured.
    """

    def __init__(self, persist_path: str, collection_name: str = "acdd_capabilities") -> None:
        try:
            import chromadb  # type: ignore
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise RuntimeError(
                "The 'chroma' vector backend requires the chromadb package. "
                "Install it with `pip install chromadb` or use ACDD_VECTOR_BACKEND=memory."
            ) from exc

        self._client = chromadb.PersistentClient(path=persist_path)
        # Cosine space to match the in-memory backend's semantics.
        self._collection = self._client.get_or_create_collection(
            name=collection_name, metadata={"hnsw:space": "cosine"}
        )

    def upsert(self, capability_id: str, vector: list[float], payload: dict[str, Any]) -> None:
        import json as _json

        # Chroma metadata values must be scalars; store the manifest as a JSON blob.
        self._collection.upsert(
            ids=[capability_id],
            embeddings=[vector],
            documents=[_json.dumps(payload)],
            metadatas=[{"capability_id": capability_id}],
        )

    def query(self, vector: list[float], top_k: int) -> list[SearchHit]:
        import json as _json

        result = self._collection.query(query_embeddings=[vector], n_results=max(1, top_k))
        ids = (result.get("ids") or [[]])[0]
        documents = (result.get("documents") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        hits: list[SearchHit] = []
        for capability_id, document, distance in zip(ids, documents, distances):
            try:
                payload = _json.loads(document) if document else {}
            except (TypeError, ValueError):
                payload = {}
            # Chroma returns cosine *distance*; convert to a similarity score.
            hits.append(
                SearchHit(capability_id=capability_id, score=1.0 - float(distance), payload=payload)
            )
        return hits

    def delete(self, capability_id: str) -> None:
        self._collection.delete(ids=[capability_id])

    def ids(self) -> list[str]:
        result = self._collection.get()
        return list(result.get("ids") or [])


class CapabilityRegistry:
    """State + semantic-index manager for platform capabilities."""

    def __init__(
        self,
        embedding_client: EmbeddingClient,
        vector_backend: VectorBackend,
        config: AcddConfig | None = None,
        *,
        on_registered: RegisteredCallback | None = None,
    ) -> None:
        self._embed = embedding_client
        self._backend = vector_backend
        self._config = config or get_config()
        self._on_registered = on_registered
        self._manifests: dict[str, CapabilityManifest] = {}

    # ------------------------------------------------------------------
    def register(self, payload: CapabilityManifest | dict[str, Any]) -> CapabilityManifest:
        """Validate, embed and index a capability manifest.

        Raises:
            ManifestValidationError: If the payload is structurally invalid.
            EmbeddingError: If the embedding backend is unreachable.
        """
        manifest = validate_manifest(payload)
        vector = self._embed.embed(manifest.embedding_text())
        self._backend.upsert(manifest.capability_id, vector, manifest.to_dict())
        self._manifests[manifest.capability_id] = manifest
        logger.info(
            "Registered capability %s (%s, risk=%s)",
            manifest.capability_id,
            manifest.metadata.category.value,
            manifest.runtime_context.risk_profile.value,
        )
        if self._on_registered is not None:
            # A downstream doc/git failure must never fail registration itself.
            try:
                self._on_registered(manifest)
            except Exception:  # noqa: BLE001 - isolation boundary
                logger.exception("on_registered callback failed for %s", manifest.capability_id)
        return manifest

    def discover(self, problem: str, top_k: int | None = None) -> list[DiscoveryResult]:
        """Return the top-K structural manifests most relevant to ``problem``."""
        if not problem or not problem.strip():
            return []
        limit = top_k if top_k is not None else self._config.discover_top_k
        vector = self._embed.embed(problem)
        hits = self._backend.query(vector, limit)
        return [
            DiscoveryResult(capability_id=hit.capability_id, score=hit.score, manifest=hit.payload)
            for hit in hits
        ]

    def get(self, capability_id: str) -> CapabilityManifest | None:
        return self._manifests.get(capability_id)

    def list_manifests(self) -> list[CapabilityManifest]:
        return list(self._manifests.values())

    def remove(self, capability_id: str) -> None:
        self._manifests.pop(capability_id, None)
        self._backend.delete(capability_id)

    def __len__(self) -> int:
        return len(self._manifests)


def build_vector_backend(config: AcddConfig | None = None) -> VectorBackend:
    """Construct the configured vector backend (``memory`` or ``chroma``)."""
    cfg = config or get_config()
    if cfg.vector_backend == "chroma":
        return ChromaVectorBackend(persist_path=cfg.chroma_path)
    if cfg.vector_backend not in ("memory", ""):
        logger.warning("Unknown ACDD_VECTOR_BACKEND=%r; falling back to memory.", cfg.vector_backend)
    return InMemoryVectorBackend()


def build_registry(
    config: AcddConfig | None = None,
    *,
    embedding_client: EmbeddingClient | None = None,
    vector_backend: VectorBackend | None = None,
    on_registered: RegisteredCallback | None = None,
) -> CapabilityRegistry:
    """Assemble a :class:`CapabilityRegistry` with sensible local defaults."""
    cfg = config or get_config()
    return CapabilityRegistry(
        embedding_client=embedding_client or build_embedding_client(cfg),
        vector_backend=vector_backend or build_vector_backend(cfg),
        config=cfg,
        on_registered=on_registered,
    )
