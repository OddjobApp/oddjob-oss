"""
Vector Memory Store
Advanced memory system with embeddings-based storage and semantic retrieval
"""

import asyncio
import json
import uuid
from typing import Dict, List, Any, Optional, Tuple, Set
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum

from core.structured_logging import get_structured_logger
from core.config import settings

logger = get_structured_logger("memory_store")


class MemoryType(Enum):
    """Types of memory entries."""
    CONVERSATION = "conversation"
    FACT = "fact"
    SKILL = "skill"
    CONTEXT = "context"
    DECISION = "decision"
    ERROR = "error"
    SUCCESS = "success"


class RelevanceLevel(Enum):
    """Relevance levels for memory retrieval."""
    LOW = 0.0
    MEDIUM = 0.5
    HIGH = 0.8
    CRITICAL = 1.0


@dataclass
class MemoryEntry:
    """A single memory entry with vector embedding."""
    content: str
    memory_type: MemoryType
    memory_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    importance: float = 1.0  # 0.0 to 1.0
    access_count: int = 0
    related_memories: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    context: Dict[str, Any] = field(default_factory=dict)
    agent_id: Optional[str] = None
    session_id: Optional[str] = None
    workflow_id: Optional[str] = None
    last_accessed: Optional[datetime] = None
    embedding: Optional[List[float]] = None
    embedding_model: Optional[str] = None
    source: Optional[str] = None  # API endpoint, agent action, etc.

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for storage."""
        return {
            "memory_id": self.memory_id,
            "content": self.content,
            "memory_type": self.memory_type.value,
            "agent_id": self.agent_id,
            "session_id": self.session_id,
            "workflow_id": self.workflow_id,
            "embedding": self.embedding,
            "embedding_model": self.embedding_model,
            "timestamp": self.timestamp.isoformat(),
            "importance": self.importance,
            "access_count": self.access_count,
            "last_accessed": self.last_accessed.isoformat() if self.last_accessed else None,
            "related_memories": self.related_memories,
            "tags": self.tags,
            "context": self.context,
            "source": self.source
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'MemoryEntry':
        """Create from dictionary."""
        # Convert enums and timestamps
        data["memory_type"] = MemoryType(data["memory_type"])
        data["timestamp"] = datetime.fromisoformat(data["timestamp"])
        if data.get("last_accessed"):
            data["last_accessed"] = datetime.fromisoformat(data["last_accessed"])

        return cls(**data)

    def update_access(self) -> None:
        """Update access tracking."""
        self.access_count += 1
        self.last_accessed = datetime.now(timezone.utc)

    def calculate_relevance_score(
        self,
        query: str,
        similarity_score: float,
        recency_weight: float = 0.3,
        importance_weight: float = 0.4,
        access_weight: float = 0.3
    ) -> float:
        """
        Calculate relevance score based on multiple factors.

        Args:
            query: Search query
            similarity_score: Vector similarity score (0.0 to 1.0)
            recency_weight: Weight for recency (how recent the memory is)
            importance_weight: Weight for importance
            access_weight: Weight for access frequency
        """
        # Recency score (newer memories get higher scores)
        now = datetime.now(timezone.utc)
        hours_old = (now - self.timestamp).total_seconds() / 3600
        recency_score = max(0.1, 1.0 / (1.0 + hours_old / 24))  # Decay over days

        # Access frequency score
        access_score = min(1.0, self.access_count / 10.0)  # Cap at 10 accesses

        # Combined score
        total_score = (
            similarity_score * 0.5 +  # Base similarity
            recency_score * recency_weight +
            self.importance * importance_weight +
            access_score * access_weight
        )

        return min(1.0, max(0.0, total_score))


@dataclass
class MemoryQuery:
    """Query parameters for memory retrieval."""
    query: str
    agent_id: Optional[str] = None
    session_id: Optional[str] = None
    workflow_id: Optional[str] = None
    memory_types: Optional[List[MemoryType]] = None
    tags: Optional[List[str]] = None
    min_relevance: float = 0.3
    limit: int = 10
    include_embeddings: bool = False
    time_range_start: Optional[datetime] = None
    time_range_end: Optional[datetime] = None

    # Advanced filtering
    context_filters: Dict[str, Any] = field(default_factory=dict)
    exclude_memory_ids: List[str] = field(default_factory=list)


@dataclass
class MemorySearchResult:
    """Result of a memory search operation."""
    query: str
    total_results: int
    results: List[Tuple[MemoryEntry, float]]  # (memory, relevance_score)
    search_time_ms: float
    search_strategy: str

    def get_top_results(self, limit: int) -> List[Tuple[MemoryEntry, float]]:
        """Get top N results by relevance score."""
        return sorted(self.results, key=lambda x: x[1], reverse=True)[:limit]

    def filter_by_relevance(self, min_score: float) -> 'MemorySearchResult':
        """Filter results by minimum relevance score."""
        filtered_results = [(mem, score) for mem, score in self.results if score >= min_score]
        return MemorySearchResult(
            query=self.query,
            total_results=len(filtered_results),
            results=filtered_results,
            search_time_ms=self.search_time_ms,
            search_strategy=self.search_strategy
        )


class VectorMemoryStore:
    """Vector-based memory storage with semantic search capabilities."""

    def __init__(self):
        self.memories: Dict[str, MemoryEntry] = {}
        self.logger = get_structured_logger("vector_memory_store")

        # Initialize vector database connection
        self._vector_db = None
        self._embedding_model = None

    async def initialize(self) -> None:
        """Initialize the memory store."""
        # Initialize vector database connection
        await self._init_vector_db()

        # Initialize embedding model
        await self._init_embedding_model()

        # Load existing memories
        await self._load_memories()

        self.logger.info("Vector memory store initialized")

    async def _init_vector_db(self) -> None:
        """Initialize vector database connection."""
        # This would connect to Qdrant or similar vector database
        # For now, we'll use in-memory storage
        self._vector_db = {}
        self.logger.info("Vector database initialized (in-memory)")

    async def _init_embedding_model(self) -> None:
        """Initialize embedding model."""
        # This would load an embedding model
        # For now, we'll use mock embeddings
        self._embedding_model = "mock-embedding-model"
        self.logger.info("Embedding model initialized")

    async def _load_memories(self) -> None:
        """Load existing memories from storage."""
        # This would load memories from persistent storage
        # For now, start with empty store
        self.memories = {}
        self.logger.info("Memories loaded from storage")

    async def store_memory(
        self,
        content: str,
        memory_type: MemoryType,
        agent_id: Optional[str] = None,
        session_id: Optional[str] = None,
        workflow_id: Optional[str] = None,
        importance: float = 1.0,
        tags: Optional[List[str]] = None,
        context: Optional[Dict[str, Any]] = None,
        source: Optional[str] = None
    ) -> str:
        """
        Store a new memory entry.

        Returns:
            Memory ID of the stored entry
        """
        # Generate embedding for the content
        embedding = await self._generate_embedding(content)

        # Create memory entry
        memory = MemoryEntry(
            content=content,
            memory_type=memory_type,
            agent_id=agent_id,
            session_id=session_id,
            workflow_id=workflow_id,
            embedding=embedding,
            embedding_model=self._embedding_model,
            importance=importance,
            tags=tags or [],
            context=context or {},
            source=source
        )

        # Store in memory
        self.memories[memory.memory_id] = memory

        # Store embedding in vector database
        await self._store_embedding(memory.memory_id, embedding)

        # Persist to storage
        await self._persist_memory(memory)

        self.logger.info(
            f"Stored memory: {memory.memory_id}",
            extra={
                "memory_id": memory.memory_id,
                "memory_type": memory_type.value,
                "agent_id": agent_id,
                "content_length": len(content)
            }
        )

        return memory.memory_id

    async def search_memories(
        self,
        query: MemoryQuery
    ) -> MemorySearchResult:
        """
        Search memories using semantic similarity and filtering.

        Returns:
            Search results with relevance scores
        """
        import time
        start_time = time.time()

        # Generate embedding for query
        query_embedding = await self._generate_embedding(query.query)

        # Perform vector search
        candidate_memories = await self._vector_search(query_embedding, limit=query.limit * 2)

        # Apply filters and calculate relevance
        filtered_results = []
        for memory_id, similarity_score in candidate_memories:
            memory = self.memories.get(memory_id)
            if not memory:
                continue

            # Apply filters
            if not self._matches_filters(memory, query):
                continue

            # Calculate relevance score
            relevance_score = memory.calculate_relevance_score(query.query, similarity_score)
            if relevance_score >= query.min_relevance:
                memory.update_access()  # Track access
                filtered_results.append((memory, relevance_score))

        search_time = (time.time() - start_time) * 1000

        result = MemorySearchResult(
            query=query.query,
            total_results=len(filtered_results),
            results=filtered_results,
            search_time_ms=search_time,
            search_strategy="hybrid_vector_text"
        )

        self.logger.info(
            f"Memory search completed: {len(filtered_results)} results in {search_time:.2f}ms",
            extra={
                "query": query.query[:100],  # Truncate for logging
                "result_count": len(filtered_results),
                "search_time_ms": search_time
            }
        )

        return result

    async def get_memory(self, memory_id: str) -> Optional[MemoryEntry]:
        """Retrieve a specific memory by ID."""
        memory = self.memories.get(memory_id)
        if memory:
            memory.update_access()
        return memory

    async def update_memory(
        self,
        memory_id: str,
        content: Optional[str] = None,
        importance: Optional[float] = None,
        tags: Optional[List[str]] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update an existing memory."""
        memory = self.memories.get(memory_id)
        if not memory:
            return False

        updated = False

        if content is not None and content != memory.content:
            memory.content = content
            # Regenerate embedding
            memory.embedding = await self._generate_embedding(content)
            await self._update_embedding(memory_id, memory.embedding)
            updated = True

        if importance is not None:
            memory.importance = importance
            updated = True

        if tags is not None:
            memory.tags = tags
            updated = True

        if context is not None:
            memory.context.update(context)
            updated = True

        if updated:
            memory.timestamp = datetime.now(timezone.utc)
            await self._persist_memory(memory)

            self.logger.info(f"Updated memory: {memory_id}")

        return updated

    async def delete_memory(self, memory_id: str) -> bool:
        """Delete a memory entry."""
        if memory_id not in self.memories:
            return False

        # Remove from vector database
        await self._delete_embedding(memory_id)

        # Remove from memory store
        del self.memories[memory_id]

        # Remove from persistent storage
        await self._delete_persistent_memory(memory_id)

        self.logger.info(f"Deleted memory: {memory_id}")
        return True

    async def get_related_memories(
        self,
        memory_id: str,
        limit: int = 5
    ) -> List[Tuple[MemoryEntry, float]]:
        """Get memories related to a specific memory."""
        memory = self.memories.get(memory_id)
        if not memory:
            return []

        # Use the memory's embedding to find similar memories
        if not memory.embedding:
            return []

        related_candidates = await self._vector_search(memory.embedding, limit=limit + 1)

        # Remove the original memory from results
        related_candidates = [
            (mid, score) for mid, score in related_candidates
            if mid != memory_id
        ][:limit]

        # Convert to memory objects with scores
        results = []
        for related_id, score in related_candidates:
            related_memory = self.memories.get(related_id)
            if related_memory:
                related_memory.update_access()
                results.append((related_memory, score))

        return results

    async def consolidate_memories(
        self,
        agent_id: Optional[str] = None,
        max_age_days: int = 30
    ) -> int:
        """
        Consolidate old or redundant memories to optimize storage.

        Returns:
            Number of memories consolidated
        """
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=max_age_days)

        candidates = [
            memory for memory in self.memories.values()
            if (not agent_id or memory.agent_id == agent_id) and
               memory.timestamp < cutoff_date and
               memory.access_count < 3  # Low access frequency
        ]

        consolidated_count = 0
        for memory in candidates:
            # Mark for consolidation (in real implementation, this would merge similar memories)
            memory.importance *= 0.5  # Reduce importance of old, rarely accessed memories
            consolidated_count += 1

        if consolidated_count > 0:
            self.logger.info(f"Consolidated {consolidated_count} memories")

        return consolidated_count

    def _matches_filters(self, memory: MemoryEntry, query: MemoryQuery) -> bool:
        """Check if a memory matches the query filters."""
        # Agent filter
        if query.agent_id and memory.agent_id != query.agent_id:
            return False

        # Session filter
        if query.session_id and memory.session_id != query.session_id:
            return False

        # Workflow filter
        if query.workflow_id and memory.workflow_id != query.workflow_id:
            return False

        # Memory type filter
        if query.memory_types and memory.memory_type not in query.memory_types:
            return False

        # Tags filter
        if query.tags:
            memory_tags = set(memory.tags)
            query_tags = set(query.tags)
            if not query_tags.issubset(memory_tags):
                return False

        # Time range filter
        if query.time_range_start and memory.timestamp < query.time_range_start:
            return False
        if query.time_range_end and memory.timestamp > query.time_range_end:
            return False

        # Context filters
        for key, value in query.context_filters.items():
            if key not in memory.context or memory.context[key] != value:
                return False

        # Exclude specific memories
        if memory.memory_id in query.exclude_memory_ids:
            return False

        return True

    async def _generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for text content."""
        # In a real implementation, this would call an embedding model
        # For now, return a mock embedding
        import hashlib
        import struct

        # Generate a deterministic but random-looking embedding based on content
        hash_obj = hashlib.sha256(text.encode())
        hash_bytes = hash_obj.digest()

        # Convert to float list (mock 384-dimensional embedding)
        embedding = []
        for i in range(0, 32, 4):  # Use first 32 bytes
            # Convert 4 bytes to float
            float_val = struct.unpack('f', hash_bytes[i:i+4])[0] if i+4 <= len(hash_bytes) else 0.0
            embedding.append(float_val)

        # Normalize to -1 to 1 range
        embedding = [(x % 2 - 1) for x in embedding]

        return embedding[:384]  # Ensure consistent dimension

    async def _vector_search(
        self,
        query_embedding: List[float],
        limit: int = 10
    ) -> List[Tuple[str, float]]:
        """
        Perform vector similarity search.

        Returns:
            List of (memory_id, similarity_score) tuples
        """
        # In a real implementation, this would query the vector database
        # For now, use a simple mock similarity calculation

        results = []
        for memory_id, memory in self.memories.items():
            if memory.embedding:
                # Calculate cosine similarity (simplified)
                similarity = self._cosine_similarity(query_embedding, memory.embedding)
                results.append((memory_id, similarity))

        # Sort by similarity and return top results
        results.sort(key=lambda x: x[1], reverse=True)
        return results[:limit]

    def _cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """Calculate cosine similarity between two vectors."""
        import math

        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        norm1 = math.sqrt(sum(a * a for a in vec1))
        norm2 = math.sqrt(sum(b * b for b in vec2))

        if norm1 == 0 or norm2 == 0:
            return 0.0

        return dot_product / (norm1 * norm2)

    async def _store_embedding(self, memory_id: str, embedding: List[float]) -> None:
        """Store embedding in vector database."""
        # Mock implementation
        if self._vector_db is not None:
            self._vector_db[memory_id] = embedding

    async def _update_embedding(self, memory_id: str, embedding: List[float]) -> None:
        """Update embedding in vector database."""
        await self._store_embedding(memory_id, embedding)

    async def _delete_embedding(self, memory_id: str) -> None:
        """Delete embedding from vector database."""
        if self._vector_db is not None and memory_id in self._vector_db:
            del self._vector_db[memory_id]

    async def _persist_memory(self, memory: MemoryEntry) -> None:
        """Persist memory to storage."""
        # In a real implementation, this would save to database
        # For now, just log
        pass

    async def _delete_persistent_memory(self, memory_id: str) -> None:
        """Delete memory from persistent storage."""
        # In a real implementation, this would delete from database
        pass


# Global memory store instance
memory_store = VectorMemoryStore()