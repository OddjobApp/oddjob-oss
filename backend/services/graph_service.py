import networkx as nx
from typing import List, Dict, Any, Optional, Set
import time
from sqlalchemy import create_engine, text
from core.config import settings
from core.logging import get_logger

logger = get_logger(__name__)

class GraphService:
    """
    Advanced Graph Analysis and Traversal Service.
    Uses networkx for high-performance graph algorithms and SQLAlchemy for DB access.
    """

    def __init__(self):
        self.engine = create_engine(settings.DATABASE_URL) if settings.DATABASE_URL else None
        logger.info("Python GraphService initialized")

    def build_subgraph(self, nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]):
        """
        Builds a transient subgraph in memory for analysis.
        """
        sub_G = nx.MultiDiGraph()
        
        for node in nodes:
            node_id = node.get('id') or node.get('nodeId')
            if node_id:
                sub_G.add_node(node_id, **node.get('data', {}), label=node.get('label'))
            
        for edge in edges:
            sub_G.add_edge(
                edge['sourceId'], 
                edge['targetId'], 
                relation=edge.get('relation', 'RELATED_TO'),
                weight=float(edge.get('weight', 1.0))
            )
            
        return sub_G

    async def traverse(
        self, 
        seed_node_ids: List[int], 
        max_hops: int = 2,
        limit: int = 100,
        organization_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Perform multi-hop traversal starting from seed nodes.
        Returns a ranked list of relevant nodes and the edges connecting them.
        """
        if not self.engine:
            logger.error("Database connection not configured for GraphService")
            return {"nodes": [], "edges": []}

        start_time = time.time()
        nodes_map = {}
        edges_list = []
        visited_node_ids = set(seed_node_ids)
        current_frontier = set(seed_node_ids)

        # 1. Fetch seed nodes data
        with self.engine.connect() as conn:
            # Fetch seed node details
            seed_query = text("SELECT id, label, name, data FROM knowledge_nodes WHERE id = ANY(:ids)")
            result = conn.execute(seed_query, {"ids": list(seed_node_ids)})
            for row in result:
                nodes_map[row.id] = {"id": row.id, "label": row.label, "name": row.name, "data": row.data, "hop": 0}

            # 2. Multi-hop traversal
            for hop in range(1, max_hops + 1):
                if not current_frontier or len(nodes_map) >= limit:
                    break
                
                # Fetch all edges from the current frontier
                edge_query = text("""
                    SELECT id, source_id, target_id, relation, weight, data 
                    FROM knowledge_edges 
                    WHERE source_id = ANY(:ids) OR target_id = ANY(:ids)
                """)
                result = conn.execute(edge_query, {"ids": list(current_frontier)})
                
                next_frontier = set()
                new_edges_in_hop = 0
                
                for row in result:
                    # Add edge if not already present
                    edge_key = f"{row.source_id}-{row.target_id}-{row.relation}"
                    edges_list.append({
                        "id": row.id,
                        "sourceId": row.source_id,
                        "targetId": row.target_id,
                        "relation": row.relation,
                        "weight": row.weight,
                        "data": row.data
                    })
                    
                    # Track neighbors
                    for neighbor_id in [row.source_id, row.target_id]:
                        if neighbor_id not in visited_node_ids:
                            visited_node_ids.add(neighbor_id)
                            next_frontier.add(neighbor_id)
                            new_edges_in_hop += 1
                
                if not next_frontier:
                    break

                # Fetch details for the next frontier
                node_query = text("SELECT id, label, name, data FROM knowledge_nodes WHERE id = ANY(:ids)")
                result = conn.execute(node_query, {"ids": list(next_frontier)})
                for row in result:
                    nodes_map[row.id] = {"id": row.id, "label": row.label, "name": row.name, "data": row.data, "hop": hop}
                    if len(nodes_map) >= limit:
                        break
                
                current_frontier = next_frontier
                logger.debug(f"Hop {hop}: found {len(next_frontier)} new nodes")

        # 3. Build graph and rank results
        sub_G = self.build_subgraph(list(nodes_map.values()), edges_list)
        
        try:
            # PageRank for structural importance
            pagerank_scores = nx.pagerank(sub_G.to_undirected(), weight='weight')
            
            # Enrich nodes with scores
            ranked_nodes = []
            for node_id, node_data in nodes_map.items():
                node_data["structuralScore"] = pagerank_scores.get(node_id, 0.0)
                ranked_nodes.append(node_data)
                
            # Sort by score
            ranked_nodes.sort(key=lambda x: x["structuralScore"], reverse=True)
            
            duration = time.time() - start_time
            logger.info(f"Traversal completed in {duration:.2f}s. Found {len(ranked_nodes)} nodes, {len(edges_list)} edges.")
            
            return {
                "nodes": ranked_nodes,
                "edges": edges_list,
                "metrics": {
                    "durationMs": int(duration * 1000),
                    "nodeCount": len(ranked_nodes),
                    "edgeCount": len(edges_list)
                }
            }
        except Exception as e:
            logger.error(f"Ranking failed during traversal: {str(e)}")
            return {"nodes": list(nodes_map.values()), "edges": edges_list}

    def calculate_centrality(self, nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> Dict[int, float]:
        """
        Calculate PageRank or Degree Centrality for a set of nodes.
        Used to rank the most important context nodes in RAG.
        """
        sub_G = self.build_subgraph(nodes, edges)
        if len(sub_G) == 0:
            return {}
            
        try:
            # PageRank is great for finding 'hub' concepts in documentation
            pagerank = nx.pagerank(sub_G.to_undirected(), weight='weight')
            return pagerank
        except Exception as e:
            logger.error(f"Failed to calculate PageRank: {str(e)}")
            # Fallback to simple degree centrality
            return nx.degree_centrality(sub_G)

graph_service = GraphService()
