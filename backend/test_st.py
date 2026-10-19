
try:
    print("Testing sentence-transformers import...")
    import sentence_transformers
    print("Import successful!")
    print("Version:", sentence_transformers.__version__)
    
    print("Testing model load (MiniLM)...")
    model = sentence_transformers.SentenceTransformer('all-MiniLM-L6-v2')
    print("Model loaded successfully!")
except Exception as e:
    print("Error:", e)
import sys
sys.exit(0)
