
import os
from sentence_transformers import SentenceTransformer

# Global model cache
_model = None

def get_model():
    global _model
    if _model is None:
        print("[Embedder] Loading SentenceTransformer model...")
        # Use a lightweight but effective model
        _model = SentenceTransformer('all-MiniLM-L6-v2')
        print("[Embedder] Model loaded.")
    return _model

def generate_embeddings(text: str):
    model = get_model()
    # Encode returns a numpy array, convert to list for JSON serialization
    embedding = model.encode(text)
    return embedding.tolist()
