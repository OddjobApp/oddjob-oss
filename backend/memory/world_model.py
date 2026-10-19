
"""
Generative World Model for predicting future states.
"""

import torch
import torch.nn as nn

class WorldModel(nn.Module):
    """
    A neural network that learns a predictive model of the environment.
    """

    def __init__(self, state_size, action_size, hidden_size=128):
        super(WorldModel, self).__init__()
        self.state_size = state_size
        self.action_size = action_size
        self.hidden_size = hidden_size

        # A simple GRU-based sequence model
        self.gru = nn.GRU(state_size + action_size, hidden_size, batch_first=True)
        self.fc = nn.Linear(hidden_size, state_size)

    def forward(self, state_sequence, action_sequence):
        """
        Predicts the next state based on a sequence of states and actions.
        """
        # Concatenate states and actions
        combined_sequence = torch.cat([state_sequence, action_sequence], dim=-1)

        # Get the output from the GRU
        gru_out, _ = self.gru(combined_sequence)

        # Get the last output from the sequence
        last_output = gru_out[:, -1, :]

        # Predict the next state
        next_state_prediction = self.fc(last_output)

        return next_state_prediction

    def predict_next_state(self, state_sequence, action_sequence):
        """
        A convenience method for making a single prediction.
        This assumes the input sequences are already tensors.
        """
        self.eval() # Set the model to evaluation mode
        with torch.no_grad():
            return self.forward(state_sequence, action_sequence)
