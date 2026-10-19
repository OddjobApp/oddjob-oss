"""
Memory API Routes
REST endpoints for memory operations and contextual retrieval
"""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, Query, Body
from pydantic import BaseModel, Field

from services.memory_service import memory_service
from core.api_responses import success_response, error_response, not_found_response
from core.auth_middleware import get_current_user

router = APIRouter()


# Pydantic models for API
class StoreMemoryRequest(BaseModel):
    content: str = Field(..., description="Memory content to store")
    memory_type: str = Field(default="conversation", description="Type of memory")
    importance: float = Field(default=1.0, ge=0.0, le=1.0, description="Importance score")
    tags: Optional[List[str]] = Field(default=None, description="Optional tags")
    context: Optional[Dict[str, Any]] = Field(default=None, description="Additional context")
    session_id: Optional[str] = Field(default=None, description="Session identifier")
    workflow_id: Optional[str] = Field(default=None, description="Workflow identifier")


class StoreConversationRequest(BaseModel):
    content: str = Field(..., description="Conversation content")
    session_id: str = Field(..., description="Session identifier")
    importance: float = Field(default=1.0, ge=0.0, le=1.0, description="Importance score")
    tags: Optional[List[str]] = Field(default=None, description="Optional tags")
    context: Optional[Dict[str, Any]] = Field(default=None, description="Additional context")


class StoreWorkflowRequest(BaseModel):
    content: str = Field(..., description="Workflow execution content")
    workflow_id: str = Field(..., description="Workflow identifier")
    memory_type: str = Field(default="success", description="Type of workflow memory")
    importance: float = Field(default=1.0, ge=0.0, le=1.0, description="Importance score")
    context: Optional[Dict[str, Any]] = Field(default=None, description="Execution context")


class SearchMemoriesRequest(BaseModel):
    query: str = Field(..., description="Search query")
    agent_id: Optional[str] = Field(default=None, description="Filter by agent")
    session_id: Optional[str] = Field(default=None, description="Filter by session")
    workflow_id: Optional[str] = Field(default=None, description="Filter by workflow")
    memory_types: Optional[List[str]] = Field(default=None, description="Filter by memory types")
    tags: Optional[List[str]] = Field(default=None, description="Filter by tags")
    min_relevance: float = Field(default=0.3, ge=0.0, le=1.0, description="Minimum relevance score")
    limit: int = Field(default=10, ge=1, le=100, description="Maximum results")


class ConversationContextRequest(BaseModel):
    current_query: str = Field(..., description="Current user query")
    conversation_history: List[Dict[str, Any]] = Field(..., description="Recent conversation history")
    max_context_length: int = Field(default=2000, ge=100, le=10000, description="Maximum context length")


class MemoryResponse(BaseModel):
    memory_id: str
    content: str
    memory_type: str
    importance: float
    tags: List[str]
    timestamp: str
    access_count: int
    agent_id: Optional[str]
    session_id: Optional[str]
    workflow_id: Optional[str]


class ContextResult(BaseModel):
    primary_memory: Dict[str, Any]
    related_memories: List[Dict[str, Any]]
    context_metadata: Dict[str, Any]


class ContextualRetrievalResponse(BaseModel):
    query: str
    results: List[ContextResult]
    metadata: Dict[str, Any]


class MemoryStatsResponse(BaseModel):
    total_memories: int
    memory_distribution: Dict[str, Any]
    statistics: Dict[str, Any]
    storage_info: Dict[str, Any]


# Routes

@router.post("/memories")
async def store_memory(
    request: StoreMemoryRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Store a new memory entry."""
    try:
        from core.memory_store import MemoryType

        # Validate memory type
        try:
            memory_type = MemoryType(request.memory_type.upper())
        except ValueError:
            return error_response(f"Invalid memory type: {request.memory_type}", 400)

        memory_id = await memory_service.memory_store.store_memory(
            content=request.content,
            memory_type=memory_type,
            agent_id=current_user.get("id"),
            session_id=request.session_id,
            workflow_id=request.workflow_id,
            importance=request.importance,
            tags=request.tags or [],
            context=request.context or {},
            source="api"
        )

        return success_response(
            data={"memory_id": memory_id},
            message="Memory stored successfully"
        )

    except Exception as e:
        return error_response(f"Failed to store memory: {str(e)}", 500)


@router.post("/memories/conversation")
async def store_conversation_memory(
    request: StoreConversationRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Store a conversation memory with intelligent processing."""
    try:
        memory_id = await memory_service.store_conversation_memory(
            content=request.content,
            agent_id=current_user.get("id"),
            session_id=request.session_id,
            importance=request.importance,
            tags=request.tags,
            context=request.context
        )

        return success_response(
            data={"memory_id": memory_id},
            message="Conversation memory stored successfully"
        )

    except Exception as e:
        return error_response(f"Failed to store conversation memory: {str(e)}", 500)


@router.post("/memories/workflow")
async def store_workflow_memory(
    request: StoreWorkflowRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Store a workflow execution memory."""
    try:
        from core.memory_store import MemoryType

        # Validate memory type
        try:
            memory_type = MemoryType(request.memory_type.upper())
        except ValueError:
            return error_response(f"Invalid memory type: {request.memory_type}", 400)

        memory_id = await memory_service.store_workflow_memory(
            content=request.content,
            agent_id=current_user.get("id"),
            workflow_id=request.workflow_id,
            memory_type=memory_type,
            importance=request.importance,
            context=request.context
        )

        return success_response(
            data={"memory_id": memory_id},
            message="Workflow memory stored successfully"
        )

    except Exception as e:
        return error_response(f"Failed to store workflow memory: {str(e)}", 500)


@router.get("/memories/{memory_id}")
async def get_memory(
    memory_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Retrieve a specific memory by ID."""
    try:
        memory = await memory_service.memory_store.get_memory(memory_id)
        if not memory:
            return not_found_response("Memory", memory_id)

        # Check if user has access to this memory
        if memory.agent_id and memory.agent_id != current_user.get("id"):
            # In a real implementation, you'd check permissions more thoroughly
            return error_response("Access denied", 403)

        memory_response = MemoryResponse(
            memory_id=memory.memory_id,
            content=memory.content,
            memory_type=memory.memory_type.value,
            importance=memory.importance,
            tags=memory.tags,
            timestamp=memory.timestamp.isoformat(),
            access_count=memory.access_count,
            agent_id=memory.agent_id,
            session_id=memory.session_id,
            workflow_id=memory.workflow_id
        )

        return success_response(data=memory_response)

    except Exception as e:
        return error_response(f"Failed to retrieve memory: {str(e)}", 500)


@router.post("/memories/search")
async def search_memories(
    request: SearchMemoriesRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Search memories with advanced filtering."""
    try:
        from core.memory_store import MemoryType

        # Convert string types to enum
        memory_types = None
        if request.memory_types:
            try:
                memory_types = [MemoryType(mt.upper()) for mt in request.memory_types]
            except ValueError as e:
                return error_response(f"Invalid memory type: {str(e)}", 400)

        results = await memory_service.search_memories(
            query=request.query,
            filters={
                "agent_id": request.agent_id,
                "session_id": request.session_id,
                "workflow_id": request.workflow_id,
                "memory_types": memory_types,
                "tags": request.tags,
                "min_relevance": request.min_relevance
            },
            limit=request.limit
        )

        return success_response(
            data=results,
            message=f"Found {len(results['results'])} memories"
        )

    except Exception as e:
        return error_response(f"Failed to search memories: {str(e)}", 500)


@router.post("/memories/context")
async def get_context(
    query: str = Body(..., description="Search query"),
    agent_id: Optional[str] = Body(None, description="Filter by agent"),
    session_id: Optional[str] = Body(None, description="Filter by session"),
    workflow_id: Optional[str] = Body(None, description="Filter by workflow"),
    context_depth: int = Body(3, ge=1, le=10, description="Context depth"),
    max_results: int = Body(5, ge=1, le=20, description="Maximum results"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Retrieve contextual memories with AI-powered relevance."""
    try:
        context = await memory_service.retrieve_context(
            query=query,
            agent_id=agent_id or current_user.get("id"),
            session_id=session_id,
            workflow_id=workflow_id,
            context_depth=context_depth,
            max_results=max_results
        )

        return success_response(
            data=ContextualRetrievalResponse(**context),
            message="Context retrieved successfully"
        )

    except Exception as e:
        return error_response(f"Failed to retrieve context: {str(e)}", 500)


@router.post("/memories/conversation-context")
async def get_conversation_context(
    request: ConversationContextRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Build comprehensive conversation context for an agent."""
    try:
        context = await memory_service.get_conversation_context(
            agent_id=current_user.get("id"),
            current_query=request.current_query,
            conversation_history=request.conversation_history,
            max_context_length=request.max_context_length
        )

        return success_response(
            data=context,
            message="Conversation context built successfully"
        )

    except Exception as e:
        return error_response(f"Failed to build conversation context: {str(e)}", 500)


@router.get("/memories/related/{memory_id}")
async def get_related_memories(
    memory_id: str,
    limit: int = Query(5, ge=1, le=20, description="Maximum related memories"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get memories related to a specific memory."""
    try:
        related_memories = await memory_service.memory_store.get_related_memories(
            memory_id=memory_id,
            limit=limit
        )

        # Check if the original memory exists and user has access
        original_memory = await memory_service.memory_store.get_memory(memory_id)
        if not original_memory:
            return not_found_response("Memory", memory_id)

        if (original_memory.agent_id and
            original_memory.agent_id != current_user.get("id")):
            return error_response("Access denied", 403)

        # Format response
        formatted_results = [
            {
                "memory_id": memory.memory_id,
                "content": memory.content[:200] + "..." if len(memory.content) > 200 else memory.content,
                "type": memory.memory_type.value,
                "similarity_score": score,
                "importance": memory.importance,
                "timestamp": memory.timestamp.isoformat()
            }
            for memory, score in related_memories
        ]

        return success_response(
            data={"related_memories": formatted_results},
            message=f"Found {len(formatted_results)} related memories"
        )

    except Exception as e:
        return error_response(f"Failed to get related memories: {str(e)}", 500)


@router.get("/memories/stats")
async def get_memory_stats(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Get comprehensive memory statistics."""
    try:
        stats = await memory_service.get_memory_stats()
        return success_response(data=MemoryStatsResponse(**stats))

    except Exception as e:
        return error_response(f"Failed to get memory stats: {str(e)}", 500)


@router.post("/memories/consolidate")
async def consolidate_memories(
    agent_id: Optional[str] = Body(None, description="Specific agent to consolidate"),
    max_age_days: int = Body(30, ge=1, le=365, description="Maximum age in days"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Consolidate and optimize memory storage."""
    try:
        # Only allow users to consolidate their own memories
        target_agent_id = agent_id or current_user.get("id")

        if agent_id and agent_id != current_user.get("id"):
            # In a real implementation, check admin permissions
            return error_response("Can only consolidate own memories", 403)

        result = await memory_service.consolidate_memories(
            agent_id=target_agent_id,
            max_age_days=max_age_days
        )

        return success_response(
            data=result,
            message="Memory consolidation completed"
        )

    except Exception as e:
        return error_response(f"Failed to consolidate memories: {str(e)}", 500)


@router.get("/memories/export")
async def export_memories(
    agent_id: Optional[str] = Query(None, description="Specific agent to export"),
    format: str = Query("json", description="Export format"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Export memories for backup or analysis."""
    try:
        # Only allow users to export their own memories
        target_agent_id = agent_id or current_user.get("id")

        if agent_id and agent_id != current_user.get("id"):
            # In a real implementation, check admin permissions
            return error_response("Can only export own memories", 403)

        export_data = await memory_service.export_memories(
            agent_id=target_agent_id,
            format=format
        )

        return success_response(
            data=export_data,
            message=f"Exported {export_data['total_memories']} memories"
        )

    except Exception as e:
        return error_response(f"Failed to export memories: {str(e)}", 500)


@router.delete("/memories/{memory_id}")
async def delete_memory(
    memory_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Delete a memory entry."""
    try:
        # Check if memory exists and user has access
        memory = await memory_service.memory_store.get_memory(memory_id)
        if not memory:
            return not_found_response("Memory", memory_id)

        if memory.agent_id and memory.agent_id != current_user.get("id"):
            # In a real implementation, check admin permissions
            return error_response("Access denied", 403)

        success = await memory_service.memory_store.delete_memory(memory_id)
        if not success:
            return error_response("Failed to delete memory", 500)

        return success_response(message="Memory deleted successfully")

    except Exception as e:
        return error_response(f"Failed to delete memory: {str(e)}", 500)