from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import time

from services.graph_service import graph_service
from core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()

class RankNodesRequest(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    method: Optional[str] = "pagerank"

class RankNodesResponse(BaseModel):
    scores: Dict[str, float]
    processing_time: float

@router.post("/rank", response_model=RankNodesResponse)
async def rank_nodes(request: RankNodesRequest):
    """
    Rank nodes by importance using graph algorithms (PageRank, etc.)
    Helpful for pruning large RAG contexts to the most relevant 'hub' entities.
    """
    start_time = time.time()
    try:
        scores = graph_service.calculate_centrality(request.nodes, request.edges)
        
        # Convert keys to strings for JSON
        string_scores = {str(k): v for k, v in scores.items()}
        
        return RankNodesResponse(
            scores=string_scores,
            processing_time=time.time() - start_time
        )
    except Exception as e:
        logger.error(f"Ranking failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

class TraverseRequest(BaseModel):
    seed_node_ids: List[int]
    max_hops: Optional[int] = 2
    limit: Optional[int] = 100
    organization_id: Optional[int] = None

@router.post("/traverse")
async def traverse_graph(request: TraverseRequest):
    """
    Perform multi-hop traversal and structural ranking in a single call.
    """
    try:
        result = await graph_service.traverse(
            seed_node_ids=request.seed_node_ids,
            max_hops=request.max_hops,
            limit=request.limit,
            organization_id=request.organization_id
        )
        return result
    except Exception as e:
        logger.error(f"Traversal failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
async def graph_health():
    return {"status": "ok", "engine": "networkx"}
