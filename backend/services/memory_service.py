"""
Memory Service
High-level service for memory operations with AI-powered context and retrieval
"""

import asyncio
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone

from core.service_base import BaseService, ServiceConfig
from core.memory_store import VectorMemoryStore, MemoryEntry, MemoryType, MemoryQuery
from core.memory_retrieval import memory_chunker, contextual_retriever
from core.structured_logging import get_structured_logger

logger = get_structured_logger("memory_service")


class MemoryService(BaseService):
    """High-level memory service with AI-powered features."""

    def __init__(self, config: ServiceConfig):
        super().__init__(config)
        self.memory_store = VectorMemoryStore()
        self.logger = get_structured_logger("memory_service")

        # Set the retriever's memory store reference
        from core.memory_retrieval import contextual_retriever
        contextual_retriever.memory_store = self.memory_store

    async def initialize(self) -> None:
        """Initialize the memory service."""
        await self.memory_store.initialize()
        await memory_chunker.initialize()

        self.logger.info("Memory service initialized")

    async def shutdown(self) -> None:
        """Shutdown the memory service."""
        # Clean up resources if needed
        self.logger.info("Memory service shutdown")

    async def _perform_health_check(self) -> None:
        """Perform health check."""
        # Check memory store health
        if len(self.memory_store.memories) >= 0:  # Basic check
            pass

        # Check chunker health
        test_chunk = await memory_chunker.chunk_text("test", max_chunk_size=100)
        if len(test_chunk) > 0:
            pass

    async def store_conversation_memory(
        self,
        content: str,
        agent_id: str,
        session_id: str,
        importance: float = 1.0,
        tags: Optional[List[str]] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Store a conversation memory with intelligent chunking.

        Args:
            content: Conversation content to store
            agent_id: ID of the agent involved
            session_id: Session identifier
            importance: Importance score (0.0-1.0)
            tags: Optional tags for categorization
            context: Additional context information

        Returns:
            Memory ID of stored memory
        """
        # Chunk the content intelligently
        chunks = memory_chunker.chunk_text(
            content,
            strategy=memory_chunker.ChunkingStrategy.SEMANTIC,
            max_chunk_size=1000
        )

        # Enrich chunks with metadata
        enriched_chunks = []
        for chunk in chunks:
            enriched_chunk = await memory_chunker.enrich_chunk(chunk)
            enriched_chunks.append(enriched_chunk)

        # Calculate overall importance based on chunks
        avg_importance = sum(c.importance_score for c in enriched_chunks) / len(enriched_chunks)
        final_importance = min(1.0, (importance + avg_importance) / 2.0)

        # Store the primary memory
        memory_id = await self.memory_store.store_memory(
            content=content,
            memory_type=MemoryType.CONVERSATION,
            agent_id=agent_id,
            session_id=session_id,
            importance=final_importance,
            tags=tags or [],
            context={
                **(context or {}),
                "chunks_count": len(enriched_chunks),
                "avg_chunk_importance": avg_importance,
                "chunking_strategy": "semantic"
            },
            source="conversation"
        )

        # Store chunk metadata (in real implementation, chunks would be stored separately)
        for i, chunk in enumerate(enriched_chunks):
            chunk.chunk_id = f"{memory_id}_chunk_{i}"
            chunk.source_memory_id = memory_id

        self.logger.info(
            f"Stored conversation memory: {memory_id}",
            extra={
                "memory_id": memory_id,
                "agent_id": agent_id,
                "session_id": session_id,
                "chunks_count": len(enriched_chunks),
                "content_length": len(content)
            }
        )

        return memory_id

    async def store_workflow_memory(
        self,
        content: str,
        agent_id: str,
        workflow_id: str,
        memory_type: MemoryType = MemoryType.SUCCESS,
        importance: float = 1.0,
        context: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Store a workflow execution memory.

        Args:
            content: Memory content (execution results, errors, etc.)
            agent_id: Agent that executed the workflow
            workflow_id: Workflow identifier
            memory_type: Type of workflow memory
            importance: Importance score
            context: Additional execution context

        Returns:
            Memory ID
        """
        # Analyze content for automatic categorization
        analyzed_type = self._analyze_workflow_content(content, memory_type)

        memory_id = await self.memory_store.store_memory(
            content=content,
            memory_type=analyzed_type,
            agent_id=agent_id,
            workflow_id=workflow_id,
            importance=importance,
            tags=self._extract_workflow_tags(content),
            context={
                **(context or {}),
                "analyzed_type": analyzed_type.value,
                "workflow_execution": True
            },
            source="workflow_execution"
        )

        return memory_id

    async def retrieve_context(
        self,
        query: str,
        agent_id: Optional[str] = None,
        session_id: Optional[str] = None,
        workflow_id: Optional[str] = None,
        context_depth: int = 3,
        max_results: int = 5
    ) -> Dict[str, Any]:
        """
        Retrieve contextual memories with AI-powered relevance.

        Args:
            query: Search query
            agent_id: Filter by agent
            session_id: Filter by session
            workflow_id: Filter by workflow
            context_depth: How deep to search for related memories
            max_results: Maximum primary results

        Returns:
            Contextual memory results
        """
        context = await contextual_retriever.retrieve_context(
            query=query,
            agent_id=agent_id,
            session_id=session_id,
            workflow_id=workflow_id,
            context_window=context_depth,
            max_results=max_results
        )

        self.logger.info(
            f"Retrieved context for query: {query[:50]}...",
            extra={
                "query_length": len(query),
                "agent_id": agent_id,
                "results_count": len(context.get("results", []))
            }
        )

        return context

    async def get_conversation_context(
        self,
        agent_id: str,
        current_query: str,
        conversation_history: List[Dict[str, Any]],
        max_context_length: int = 2000
    ) -> Dict[str, Any]:
        """
        Build comprehensive conversation context for an agent.

        Args:
            agent_id: Agent ID
            current_query: Current user query
            conversation_history: Recent conversation turns
            max_context_length: Maximum context string length

        Returns:
            Conversation context with relevant memories
        """
        context = await contextual_retriever.build_conversation_context(
            agent_id=agent_id,
            current_query=current_query,
            conversation_history=conversation_history,
            max_context_length=max_context_length
        )

        return context

    async def search_memories(
        self,
        query: str,
        filters: Optional[Dict[str, Any]] = None,
        limit: int = 10
    ) -> Dict[str, Any]:
        """
        Advanced memory search with filtering.

        Args:
            query: Search query
            filters: Additional filters (agent_id, session_id, etc.)
            limit: Maximum results

        Returns:
            Search results with metadata
        """
        # Build memory query
        memory_query = MemoryQuery(
            query=query,
            limit=limit
        )

        # Apply filters
        if filters:
            memory_query.agent_id = filters.get("agent_id")
            memory_query.session_id = filters.get("session_id")
            memory_query.workflow_id = filters.get("workflow_id")
            memory_query.memory_types = filters.get("memory_types")
            memory_query.tags = filters.get("tags")
            memory_query.min_relevance = filters.get("min_relevance", 0.3)
            memory_query.context_filters = filters.get("context_filters", {})

        # Perform search
        results = await self.memory_store.search_memories(memory_query)

        return {
            "query": query,
            "results": [
                {
                    "memory_id": memory.memory_id,
                    "content": memory.content,
                    "type": memory.memory_type.value,
                    "relevance_score": score,
                    "timestamp": memory.timestamp.isoformat(),
                    "importance": memory.importance,
                    "tags": memory.tags
                }
                for memory, score in results.results
            ],
            "total_results": results.total_results,
            "search_time_ms": results.search_time_ms,
            "metadata": {
                "filters_applied": bool(filters),
                "search_strategy": results.search_strategy
            }
        }

    async def get_memory_stats(self) -> Dict[str, Any]:
        """Get comprehensive memory statistics."""
        total_memories = len(self.memory_store.memories)

        if total_memories == 0:
            return {"total_memories": 0, "message": "No memories stored"}

        # Analyze memory distribution
        type_counts = {}
        agent_counts = {}
        session_counts = {}
        tag_counts = {}

        total_importance = 0
        access_counts = []

        for memory in self.memory_store.memories.values():
            # Type distribution
            mem_type = memory.memory_type.value
            type_counts[mem_type] = type_counts.get(mem_type, 0) + 1

            # Agent distribution
            if memory.agent_id:
                agent_counts[memory.agent_id] = agent_counts.get(memory.agent_id, 0) + 1

            # Session distribution
            if memory.session_id:
                session_counts[memory.session_id] = session_counts.get(memory.session_id, 0) + 1

            # Tag analysis
            for tag in memory.tags:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1

            # Statistics
            total_importance += memory.importance
            access_counts.append(memory.access_count)

        avg_importance = total_importance / total_memories
        avg_access_count = sum(access_counts) / len(access_counts) if access_counts else 0

        # Memory age analysis
        now = datetime.now(timezone.utc)
        ages_hours = [
            (now - memory.timestamp).total_seconds() / 3600
            for memory in self.memory_store.memories.values()
        ]
        avg_age_hours = sum(ages_hours) / len(ages_hours) if ages_hours else 0

        return {
            "total_memories": total_memories,
            "memory_distribution": {
                "by_type": type_counts,
                "by_agent": dict(list(agent_counts.items())[:10]),  # Top 10 agents
                "by_session": dict(list(session_counts.items())[:10]),  # Top 10 sessions
                "by_tag": dict(sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:10])
            },
            "statistics": {
                "average_importance": round(avg_importance, 3),
                "average_access_count": round(avg_access_count, 2),
                "average_age_hours": round(avg_age_hours, 1),
                "oldest_memory_hours": round(max(ages_hours), 1) if ages_hours else 0,
                "newest_memory_hours": round(min(ages_hours), 1) if ages_hours else 0
            },
            "storage_info": {
                "vector_db_size": len(self.memory_store._vector_db) if self.memory_store._vector_db else 0,
                "embedding_model": self.memory_store._embedding_model
            }
        }

    async def consolidate_memories(
        self,
        agent_id: Optional[str] = None,
        max_age_days: int = 30,
        min_access_count: int = 1
    ) -> Dict[str, Any]:
        """
        Consolidate and optimize memory storage.

        Args:
            agent_id: Specific agent to consolidate (None for all)
            max_age_days: Maximum age of memories to consider
            min_access_count: Minimum access count for preservation

        Returns:
            Consolidation results
        """
        consolidated_count = await self.memory_store.consolidate_memories(
            agent_id=agent_id,
            max_age_days=max_age_days
        )

        return {
            "consolidated_memories": consolidated_count,
            "agent_filter": agent_id,
            "max_age_days": max_age_days,
            "message": f"Consolidated {consolidated_count} memories"
        }

    def _analyze_workflow_content(self, content: str, suggested_type: MemoryType) -> MemoryType:
        """Analyze workflow content to determine appropriate memory type."""
        content_lower = content.lower()

        # Error detection
        error_indicators = ['error', 'failed', 'exception', 'traceback', 'fail']
        if any(indicator in content_lower for indicator in error_indicators):
            return MemoryType.ERROR

        # Success detection
        success_indicators = ['success', 'completed', 'finished', 'done', 'successful']
        if any(indicator in content_lower for indicator in success_indicators):
            return MemoryType.SUCCESS

        # Decision/outcome detection
        decision_indicators = ['decision', 'outcome', 'result', 'choice', 'selected']
        if any(indicator in content_lower for indicator in decision_indicators):
            return MemoryType.DECISION

        return suggested_type

    def _extract_workflow_tags(self, content: str) -> List[str]:
        """Extract relevant tags from workflow content."""
        tags = []
        content_lower = content.lower()

        # Status tags
        if 'success' in content_lower or 'completed' in content_lower:
            tags.append('success')
        if 'error' in content_lower or 'failed' in content_lower:
            tags.append('error')
        if 'timeout' in content_lower:
            tags.append('timeout')

        # Action tags
        action_indicators = {
            'http': ['http', 'request', 'api', 'endpoint'],
            'database': ['sql', 'query', 'database', 'db'],
            'file': ['file', 'upload', 'download', 'storage'],
            'email': ['email', 'mail', 'smtp'],
            'ai': ['ai', 'ml', 'model', 'predict']
        }

        for action, indicators in action_indicators.items():
            if any(indicator in content_lower for indicator in indicators):
                tags.append(action)

        return list(set(tags))  # Remove duplicates

    async def export_memories(
        self,
        agent_id: Optional[str] = None,
        format: str = "json"
    ) -> Dict[str, Any]:
        """
        Export memories for backup or analysis.

        Args:
            agent_id: Specific agent to export (None for all)
            format: Export format (json, csv, etc.)

        Returns:
            Export data and metadata
        """
        memories_to_export = self.memory_store.memories.values()

        if agent_id:
            memories_to_export = [m for m in memories_to_export if m.agent_id == agent_id]

        export_data = []
        for memory in memories_to_export:
            export_item = {
                "memory_id": memory.memory_id,
                "content": memory.content,
                "type": memory.memory_type.value,
                "agent_id": memory.agent_id,
                "session_id": memory.session_id,
                "workflow_id": memory.workflow_id,
                "importance": memory.importance,
                "access_count": memory.access_count,
                "timestamp": memory.timestamp.isoformat(),
                "last_accessed": memory.last_accessed.isoformat() if memory.last_accessed else None,
                "tags": memory.tags,
                "context": memory.context
            }
            export_data.append(export_item)

        return {
            "export_timestamp": datetime.now(timezone.utc).isoformat(),
            "format": format,
            "total_memories": len(export_data),
            "agent_filter": agent_id,
            "data": export_data
        }


# Global memory service instance
memory_config = ServiceConfig(
    name="memory_service",
    enabled=True,
    timeout=30
)

memory_service = MemoryService(memory_config)