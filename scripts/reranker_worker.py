import sys
import json
import os

# Stage 2: Specialist Reranker Worker
# This script is intended to be run in a Python environment with sentence-transformers.
# It acts as the 'Specialist' that re-evaluates candidates from search.

def rerank(query, documents, model_name="BAAI/bge-reranker-v2-m3"):
    """
    Reranks documents against a query using a Cross-Encoder.
    Returns a list of scores.
    """
    try:
        from sentence_transformers import CrossEncoder
        # Check if we should use GPU
        import torch
        device = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
        
        encoder = CrossEncoder(model_name, device=device)
        pairs = [[query, doc] for doc in documents]
        scores = encoder.predict(pairs)
        return scores.tolist()
    except ImportError:
        # Fallback: Scrabble-style heuristic if model not available
        # Note: In production, ensure sentence-transformers is installed.
        print("WARNING: sentence-transformers not found. Using fallback heuristic.", file=sys.stderr)
        scores = []
        query_words = set(query.lower().split())
        for doc in documents:
            doc_lower = doc.lower()
            overlap = sum(1 for word in query_words if word in doc_lower)
            score = overlap / max(len(query_words), 1)
            scores.append(score)
        return scores

if __name__ == "__main__":
    # Expect JSON input via stdin: {"query": "...", "documents": ["...", "..."]}
    try:
        raw_input = sys.stdin.read()
        if not raw_input:
            sys.exit(0)
            
        data = json.loads(raw_input)
        query = data.get("query", "")
        documents = data.get("documents", [])
        model = data.get("model", "BAAI/bge-reranker-v2-m3")
        
        if not query or not documents:
            print(json.dumps({"scores": [], "error": "Missing query or documents"}))
            sys.exit(0)
            
        scores = rerank(query, documents, model)
        print(json.dumps({"scores": scores}))
        
    except Exception as e:
        print(json.dumps({"scores": [], "error": str(e)}))
        sys.exit(1)
