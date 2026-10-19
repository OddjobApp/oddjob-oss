
"""
Training script for the Generative World Model.
"""

import torch
import torch.optim as optim
import torch.nn as nn
import json
import os

# --- Redefine necessary classes locally to make the script self-contained ---

class WorldModel(nn.Module):
    """
    A neural network that learns a predictive model of the environment.
    """
    def __init__(self, state_size, action_size, hidden_size=128):
        super(WorldModel, self).__init__()
        self.gru = nn.GRU(state_size + action_size, hidden_size, batch_first=True)
        self.fc = nn.Linear(hidden_size, state_size)

    def forward(self, state_sequence, action_sequence):
        combined_sequence = torch.cat([state_sequence, action_sequence], dim=-1)
        gru_out, _ = self.gru(combined_sequence)
        last_output = gru_out[:, -1, :]
        next_state_prediction = self.fc(last_output)
        return next_state_prediction

# --- Main Training Logic ---

def train_world_model():
    """
    This function trains the world model on data from the persistent training data file.
    """
    print("Training world model from persistent data...")

    # Define path relative to this script's location
    training_data_path = os.path.join(os.path.dirname(__file__), '../backend/memory/training_data/world_model_data.jsonl')

    if not os.path.exists(training_data_path):
        print("No training data file found.")
        return

    # Load the data
    training_data = []
    with open(training_data_path, 'r') as f:
        for line in f:
            training_data.append(json.loads(line))
    
    if not training_data:
        print("No training data available in the file.")
        return

    # Infer sizes from the data itself
    state_size = len(training_data[0]['state'])
    action_size = len(training_data[0]['action'])

    # Instantiate the model
    world_model = WorldModel(state_size, action_size)
    criterion = nn.MSELoss()
    optimizer = optim.Adam(world_model.parameters(), lr=0.001)

    # Prepare the data
    state_tensors = [torch.tensor(d['state']) for d in training_data]
    action_tensors = [torch.tensor(d['action']) for d in training_data]
    next_state_tensors = [torch.tensor(d['next_state']) for d in training_data]
    
    state_seq = torch.stack(state_tensors).unsqueeze(1).float()
    action_seq = torch.stack(action_tensors).unsqueeze(1).float()
    next_state = torch.stack(next_state_tensors).float()

    # Training loop
    for epoch in range(10):
        optimizer.zero_grad()
        
        # Get the model's prediction
        predicted_next_state = world_model(state_seq, action_seq)

        # Calculate the loss
        loss = criterion(predicted_next_state, next_state)

        # Backpropagate and optimize
        loss.backward()
        optimizer.step()

        print(f"Epoch {epoch+1}, Loss: {loss.item()}")

    # Save the trained model
    torch.save(world_model.state_dict(), 'world_model.pth')
    print("World model trained and saved as world_model.pth")

if __name__ == "__main__":
    train_world_model()
