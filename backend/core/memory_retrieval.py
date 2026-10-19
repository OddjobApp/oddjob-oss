"""
Memory Chunking and Contextual Retrieval
Advanced memory processing with intelligent chunking and retrieval strategies
"""

import re
import nltk
from typing import List, Dict, Any, Optional, Tuple, Set
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

from core.structured_logging import get_structured_logger
from core.memory_store import MemoryEntry, MemoryType, MemoryQuery

logger = get_structured_logger("memory_chunking")


class ChunkingStrategy(Enum):
    """Strategies for chunking text into memory units."""
    SENTENCE = "sentence"      # Split by sentences
    PARAGRAPH = "paragraph"    # Split by paragraphs
    FIXED_SIZE = "fixed_size"  # Fixed character/word count
    SEMANTIC = "semantic"      # Semantic meaning-based chunks
    TOPIC = "topic"           # Topic-based segmentation


@dataclass
class MemoryChunk:
    """A chunk of memory with metadata."""
    content: str
    chunk_id: str
    source_memory_id: str
    position: int  # Position in original content
    chunk_type: ChunkingStrategy

    # Semantic metadata
    summary: Optional[str] = None
    keywords: List[str] = field(default_factory=list)
    entities: List[str] = field(default_factory=list)
    sentiment_score: Optional[float] = None  # -1 to 1

    # Importance scoring
    importance_score: float = 1.0

    # Relationships
    related_chunks: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "content": self.content,
            "chunk_id": self.chunk_id,
            "source_memory_id": self.source_memory_id,
            "position": self.position,
            "chunk_type": self.chunk_type.value,
            "summary": self.summary,
            "keywords": self.keywords,
            "entities": self.entities,
            "sentiment_score": self.sentiment_score,
            "importance_score": self.importance_score,
            "related_chunks": self.related_chunks
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'MemoryChunk':
        """Create from dictionary."""
        data["chunk_type"] = ChunkingStrategy(data["chunk_type"])
        return cls(**data)


class MemoryChunker:
    """Intelligent text chunking for memory storage."""

    def __init__(self):
        self.logger = get_structured_logger("memory_chunker")

        # Initialize NLTK (lazy loading)
        self._nltk_initialized = False

    async def initialize(self) -> None:
        """Initialize the chunker."""
        try:
            # Download required NLTK data
            import nltk
            nltk.download('punkt', quiet=True)
            nltk.download('stopwords', quiet=True)
            self._nltk_initialized = True
            self.logger.info("Memory chunker initialized with NLTK")
        except Exception as e:
            self.logger.warning(f"Failed to initialize NLTK: {e}")
            self._nltk_initialized = False

    def chunk_text(
        self,
        text: str,
        strategy: ChunkingStrategy = ChunkingStrategy.SEMANTIC,
        max_chunk_size: int = 1000,
        overlap: int = 100
    ) -> List[MemoryChunk]:
        """
        Chunk text into memory units using specified strategy.

        Args:
            text: Text to chunk
            strategy: Chunking strategy to use
            max_chunk_size: Maximum size of each chunk
            overlap: Number of characters to overlap between chunks

        Returns:
            List of memory chunks
        """
        if strategy == ChunkingStrategy.SENTENCE:
            return self._chunk_by_sentences(text, max_chunk_size)
        elif strategy == ChunkingStrategy.PARAGRAPH:
            return self._chunk_by_paragraphs(text, max_chunk_size)
        elif strategy == ChunkingStrategy.FIXED_SIZE:
            return self._chunk_fixed_size(text, max_chunk_size, overlap)
        elif strategy == ChunkingStrategy.SEMANTIC:
            return self._chunk_semantic(text, max_chunk_size)
        elif strategy == ChunkingStrategy.TOPIC:
            return self._chunk_by_topic(text, max_chunk_size)
        else:
            # Default to semantic chunking
            return self._chunk_semantic(text, max_chunk_size)

    def _chunk_by_sentences(self, text: str, max_chunk_size: int) -> List[MemoryChunk]:
        """Chunk text by sentences."""
        chunks = []

        if self._nltk_initialized:
            try:
                from nltk.tokenize import sent_tokenize
                sentences = sent_tokenize(text)
            except:
                sentences = re.split(r'[.!?]+', text)
        else:
            sentences = re.split(r'[.!?]+', text)

        current_chunk = ""
        position = 0

        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue

            # Check if adding this sentence would exceed max size
            if len(current_chunk) + len(sentence) > max_chunk_size and current_chunk:
                # Create chunk
                chunk = MemoryChunk(
                    content=current_chunk.strip(),
                    chunk_id=f"chunk_{len(chunks)}",
                    source_memory_id="",  # Will be set by caller
                    position=position,
                    chunk_type=ChunkingStrategy.SENTENCE
                )
                chunks.append(chunk)

                # Start new chunk with overlap
                overlap_text = current_chunk[-50:] if len(current_chunk) > 50 else current_chunk
                current_chunk = overlap_text + " " + sentence
                position += len(current_chunk)
            else:
                current_chunk += " " + sentence if current_chunk else sentence

        # Add final chunk
        if current_chunk.strip():
            chunk = MemoryChunk(
                content=current_chunk.strip(),
                chunk_id=f"chunk_{len(chunks)}",
                source_memory_id="",
                position=position,
                chunk_type=ChunkingStrategy.SENTENCE
            )
            chunks.append(chunk)

        return chunks

    def _chunk_by_paragraphs(self, text: str, max_chunk_size: int) -> List[MemoryChunk]:
        """Chunk text by paragraphs."""
        # Split by double newlines (paragraphs)
        paragraphs = re.split(r'\n\s*\n', text.strip())
        chunks = []

        current_chunk = ""
        position = 0

        for paragraph in paragraphs:
            paragraph = paragraph.strip()
            if not paragraph:
                continue

            if len(current_chunk) + len(paragraph) > max_chunk_size and current_chunk:
                # Create chunk
                chunk = MemoryChunk(
                    content=current_chunk.strip(),
                    chunk_id=f"chunk_{len(chunks)}",
                    source_memory_id="",
                    position=position,
                    chunk_type=ChunkingStrategy.PARAGRAPH
                )
                chunks.append(chunk)

                current_chunk = paragraph
                position += len(current_chunk)
            else:
                current_chunk += "\n\n" + paragraph if current_chunk else paragraph

        # Add final chunk
        if current_chunk.strip():
            chunk = MemoryChunk(
                content=current_chunk.strip(),
                chunk_id=f"chunk_{len(chunks)}",
                source_memory_id="",
                position=position,
                chunk_type=ChunkingStrategy.PARAGRAPH
            )
            chunks.append(chunk)

        return chunks

    def _chunk_fixed_size(
        self,
        text: str,
        chunk_size: int,
        overlap: int
    ) -> List[MemoryChunk]:
        """Chunk text into fixed-size segments with overlap."""
        chunks = []
        start = 0

        while start < len(text):
            end = min(start + chunk_size, len(text))

            chunk_content = text[start:end]

            chunk = MemoryChunk(
                content=chunk_content,
                chunk_id=f"chunk_{len(chunks)}",
                source_memory_id="",
                position=start,
                chunk_type=ChunkingStrategy.FIXED_SIZE
            )
            chunks.append(chunk)

            # Move start position with overlap
            start = end - overlap
            if start >= len(text):
                break

        return chunks

    def _chunk_semantic(self, text: str, max_chunk_size: int) -> List[MemoryChunk]:
        """Chunk text based on semantic meaning."""
        # For now, use sentence-based chunking as semantic approximation
        # In a real implementation, this would use NLP models to identify
        # semantic boundaries (topic changes, etc.)
        return self._chunk_by_sentences(text, max_chunk_size)

    def _chunk_by_topic(self, text: str, max_chunk_size: int) -> List[MemoryChunk]:
        """Chunk text by topic boundaries."""
        # For now, use paragraph-based chunking as topic approximation
        # In a real implementation, this would use topic modeling
        return self._chunk_by_paragraphs(text, max_chunk_size)

    async def enrich_chunk(self, chunk: MemoryChunk) -> MemoryChunk:
        """
        Enrich a memory chunk with additional metadata.

        This includes keyword extraction, entity recognition, summarization, etc.
        """
        # Extract keywords
        chunk.keywords = self._extract_keywords(chunk.content)

        # Extract entities (simplified)
        chunk.entities = self._extract_entities(chunk.content)

        # Generate summary (simplified)
        chunk.summary = self._generate_summary(chunk.content)

        # Calculate sentiment (simplified)
        chunk.sentiment_score = self._calculate_sentiment(chunk.content)

        # Calculate importance based on content analysis
        chunk.importance_score = self._calculate_importance(chunk)

        return chunk

    def _extract_keywords(self, text: str) -> List[str]:
        """Extract keywords from text."""
        if not self._nltk_initialized:
            # Simple keyword extraction
            words = re.findall(r'\b\w+\b', text.lower())
            # Remove common stop words
            stop_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'}
            keywords = [word for word in words if len(word) > 3 and word not in stop_words]
            return list(set(keywords))[:10]  # Return unique keywords

        try:
            from nltk.corpus import stopwords
            from nltk.tokenize import word_tokenize
            from nltk.stem import PorterStemmer

            stop_words = set(stopwords.words('english'))
            stemmer = PorterStemmer()

            words = word_tokenize(text.lower())
            keywords = [
                stemmer.stem(word) for word in words
                if word.isalnum() and word not in stop_words and len(word) > 3
            ]

            # Count frequency and return top keywords
            from collections import Counter
            keyword_counts = Counter(keywords)
            return [word for word, _ in keyword_counts.most_common(10)]

        except Exception as e:
            self.logger.warning(f"Keyword extraction failed: {e}")
            return []

    def _extract_entities(self, text: str) -> List[str]:
        """Extract named entities from text."""
        # Simplified entity extraction - in real implementation would use NER model
        # Look for capitalized words that might be names
        words = re.findall(r'\b[A-Z][a-z]+\b', text)
        return list(set(words))[:5]  # Return unique entities

    def _generate_summary(self, text: str) -> str:
        """Generate a summary of the text."""
        # Very simplified summarization
        sentences = re.split(r'[.!?]+', text.strip())
        if len(sentences) <= 2:
            return text[:200] + "..." if len(text) > 200 else text

        # Return first and last sentences as simple summary
        first_sentence = sentences[0].strip()
        last_sentence = sentences[-1].strip()

        summary = first_sentence
        if last_sentence and last_sentence != first_sentence:
            summary += " " + last_sentence

        return summary[:300] + "..." if len(summary) > 300 else summary

    def _calculate_sentiment(self, text: str) -> float:
        """Calculate sentiment score (-1 to 1)."""
        # Very simplified sentiment analysis
        positive_words = {'good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'awesome'}
        negative_words = {'bad', 'terrible', 'awful', 'horrible', 'hate', 'worst', 'disappointing'}

        words = re.findall(r'\b\w+\b', text.lower())
        positive_count = sum(1 for word in words if word in positive_words)
        negative_count = sum(1 for word in words if word in negative_words)

        total_sentiment_words = positive_count + negative_count
        if total_sentiment_words == 0:
            return 0.0

        return (positive_count - negative_count) / total_sentiment_words

    def _calculate_importance(self, chunk: MemoryChunk) -> float:
        """Calculate importance score for a chunk."""
        score = 1.0

        # Boost score based on content characteristics
        content_lower = chunk.content.lower()

        # Keywords that indicate importance
        important_indicators = [
            'error', 'failure', 'success', 'important', 'critical',
            'urgent', 'emergency', 'security', 'bug', 'fix'
        ]

        for indicator in important_indicators:
            if indicator in content_lower:
                score *= 1.5
                break

        # Length factor (longer chunks might be more important)
        length_factor = min(2.0, len(chunk.content) / 500)
        score *= length_factor

        # Keyword diversity factor
        keyword_diversity = len(set(chunk.keywords)) / max(1, len(chunk.keywords))
        score *= (0.5 + keyword_diversity * 0.5)

        return min(5.0, max(0.1, score))  # Cap between 0.1 and 5.0


class ContextualRetriever:
    """Advanced memory retrieval with context awareness."""

    def __init__(self, memory_store):
        self.memory_store = memory_store
        self.logger = get_structured_logger("contextual_retriever")

    async def retrieve_context(
        self,
        query: str,
        agent_id: Optional[str] = None,
        session_id: Optional[str] = None,
        context_window: int = 3,
        max_results: int = 5
    ) -> Dict[str, Any]:
        """
        Retrieve contextually relevant memories.

        Args:
            query: Search query
            agent_id: Filter by agent
            session_id: Filter by session
            context_window: How many related memories to include
            max_results: Maximum number of primary results

        Returns:
            Contextual retrieval results
        """
        # Create memory query
        memory_query = MemoryQuery(
            query=query,
            agent_id=agent_id,
            session_id=session_id,
            limit=max_results * 2  # Get more for filtering
        )

        # Perform initial search
        search_results = await self.memory_store.search_memories(memory_query)

        # Get top results
        top_results = search_results.get_top_results(max_results)

        # Build context for each result
        contextual_results = []
        seen_memory_ids = set()

        for memory, relevance_score in top_results:
            if memory.memory_id in seen_memory_ids:
                continue

            seen_memory_ids.add(memory.memory_id)

            # Get related memories for context
            related_memories = await self.memory_store.get_related_memories(
                memory.memory_id,
                limit=context_window
            )

            # Build context object
            context = {
                "primary_memory": {
                    "id": memory.memory_id,
                    "content": memory.content,
                    "type": memory.memory_type.value,
                    "relevance_score": relevance_score,
                    "timestamp": memory.timestamp.isoformat(),
                    "importance": memory.importance
                },
                "related_memories": [
                    {
                        "id": rel_memory.memory_id,
                        "content": rel_memory.content[:200] + "..." if len(rel_memory.content) > 200 else rel_memory.content,
                        "type": rel_memory.memory_type.value,
                        "similarity_score": similarity_score,
                        "timestamp": rel_memory.timestamp.isoformat()
                    }
                    for rel_memory, similarity_score in related_memories
                ],
                "context_metadata": {
                    "session_context": self._extract_session_context(memory, related_memories),
                    "temporal_context": self._extract_temporal_context(memory, related_memories),
                    "thematic_context": self._extract_thematic_context(memory, related_memories)
                }
            }

            contextual_results.append(context)

        return {
            "query": query,
            "results": contextual_results,
            "metadata": {
                "total_candidates": search_results.total_results,
                "contextual_results": len(contextual_results),
                "search_time_ms": search_results.search_time_ms
            }
        }

    def _extract_session_context(
        self,
        primary_memory: MemoryEntry,
        related_memories: List[Tuple[MemoryEntry, float]]
    ) -> Dict[str, Any]:
        """Extract session-based context."""
        session_memories = [primary_memory] + [mem for mem, _ in related_memories]

        # Group by session
        sessions = {}
        for memory in session_memories:
            session_id = memory.session_id or "unknown"
            if session_id not in sessions:
                sessions[session_id] = []
            sessions[session_id].append(memory)

        # Find most relevant session
        primary_session = primary_memory.session_id or "unknown"
        session_memory_count = len(sessions.get(primary_session, []))

        return {
            "primary_session": primary_session,
            "session_memory_count": session_memory_count,
            "total_sessions": len(sessions),
            "session_density": session_memory_count / max(1, len(session_memories))
        }

    def _extract_temporal_context(
        self,
        primary_memory: MemoryEntry,
        related_memories: List[Tuple[MemoryEntry, float]]
    ) -> Dict[str, Any]:
        """Extract temporal context."""
        all_memories = [primary_memory] + [mem for mem, _ in related_memories]

        # Sort by timestamp
        sorted_memories = sorted(all_memories, key=lambda m: m.timestamp)

        # Calculate time spans
        if len(sorted_memories) > 1:
            time_span = (sorted_memories[-1].timestamp - sorted_memories[0].timestamp).total_seconds()
            avg_time_between = time_span / (len(sorted_memories) - 1)
        else:
            time_span = 0
            avg_time_between = 0

        # Find position of primary memory in timeline
        primary_index = next(
            (i for i, m in enumerate(sorted_memories) if m.memory_id == primary_memory.memory_id),
            -1
        )

        return {
            "time_span_seconds": time_span,
            "avg_time_between_memories": avg_time_between,
            "primary_memory_position": primary_index,
            "is_most_recent": primary_memory.timestamp == max(m.timestamp for m in all_memories),
            "memory_sequence": len(sorted_memories)
        }

    def _extract_thematic_context(
        self,
        primary_memory: MemoryEntry,
        related_memories: List[Tuple[MemoryEntry, float]]
    ) -> Dict[str, Any]:
        """Extract thematic context."""
        all_memories = [primary_memory] + [mem for mem, _ in related_memories]

        # Analyze themes by memory type
        type_distribution = {}
        for memory in all_memories:
            mem_type = memory.memory_type.value
            type_distribution[mem_type] = type_distribution.get(mem_type, 0) + 1

        # Extract common keywords/themes
        all_keywords = []
        for memory in all_memories:
            # In real implementation, this would use the chunk's keywords
            # For now, extract simple keywords
            words = re.findall(r'\b\w+\b', memory.content.lower())
            all_keywords.extend([w for w in words if len(w) > 4][:5])  # Top 5 longer words

        # Find most common keywords
        from collections import Counter
        keyword_counts = Counter(all_keywords)
        top_keywords = [word for word, _ in keyword_counts.most_common(5)]

        return {
            "type_distribution": type_distribution,
            "dominant_type": max(type_distribution.keys(), key=lambda k: type_distribution[k]) if type_distribution else None,
            "top_keywords": top_keywords,
            "thematic_coherence": len(top_keywords) / max(1, len(set(all_keywords)))
        }

    async def build_conversation_context(
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
            conversation_history: Recent conversation history
            max_context_length: Maximum context length in characters

        Returns:
            Conversation context with relevant memories
        """
        # Retrieve relevant memories based on current query
        memory_context = await self.retrieve_context(
            query=current_query,
            agent_id=agent_id,
            max_results=3
        )

        # Build conversation summary
        conversation_summary = self._summarize_conversation(conversation_history)

        # Combine contexts
        combined_context = {
            "current_query": current_query,
            "conversation_summary": conversation_summary,
            "relevant_memories": memory_context["results"],
            "context_metadata": {
                "memory_results_count": len(memory_context["results"]),
                "conversation_turns": len(conversation_history),
                "total_context_length": len(str(memory_context) + conversation_summary)
            }
        }

        # Truncate if too long
        context_str = str(combined_context)
        if len(context_str) > max_context_length:
            # Truncate memory results to fit
            max_memories = max(1, len(memory_context["results"]) * max_context_length // (len(context_str) * 2))
            combined_context["relevant_memories"] = memory_context["results"][:max_memories]
            combined_context["context_metadata"]["truncated"] = True

        return combined_context

    def _summarize_conversation(self, history: List[Dict[str, Any]]) -> str:
        """Create a summary of recent conversation history."""
        if not history:
            return "No previous conversation."

        # Simple summarization - extract key points
        summaries = []
        for item in history[-5:]:  # Last 5 messages
            content = item.get("content", "")[:100]  # First 100 chars
            role = item.get("role", "unknown")
            summaries.append(f"{role}: {content}")

        return " | ".join(summaries)


# Global instances
memory_chunker = MemoryChunker()
contextual_retriever = ContextualRetriever(None)  # Will be set when memory store is initialized