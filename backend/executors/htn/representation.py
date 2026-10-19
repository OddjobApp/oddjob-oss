
"""
Handles the conversion of world states and actions into numerical vectors.
"""

import torch
from sentence_transformers import SentenceTransformer

from .state import WorldState
from .planner import Task

# The embedding dimension of the all-MiniLM-L6-v2 model
EMBEDDING_DIM = 384
STATE_VECTOR_SIZE = 1 + EMBEDDING_DIM # 1 for browser_open flag + embedding dim
ACTION_VECTOR_SIZE = 4

# Load the sentence transformer model
# This will download the model the first time it is run.
model = SentenceTransformer('all-MiniLM-L6-v2')

def state_to_vector(state: WorldState) -> torch.Tensor:
    """Converts a WorldState object into a numerical vector using a sentence transformer."""
    # Create a tensor for the boolean flag
    browser_open_tensor = torch.tensor([1.0 if state.is_browser_open else 0.0])

    # Create an embedding for the URL and page content
    text_to_embed = f"{state.current_url or ''} {state.page_content or ''}".strip()
    if text_to_embed:
        text_embedding = model.encode(text_to_embed, convert_to_tensor=True)
    else:
        text_embedding = torch.zeros(EMBEDDING_DIM)
    
    # Concatenate the flag and the embedding
    return torch.cat((browser_open_tensor, text_embedding.cpu()))

def action_to_vector(action: Task) -> torch.Tensor:
    """Converts a Task (action) object into a numerical vector."""
    # This is a placeholder. A real implementation would have a fixed vocabulary
    # of all possible actions.
    vector = torch.zeros(ACTION_VECTOR_SIZE)
    action_map = {
        "open_browser": 0,
        "type_url": 1,
        "press_enter": 2,
    }
    action_index = action_map.get(action.name, -1)
    if action_index != -1:
        vector[action_index] = 1.0
        
    return vector
