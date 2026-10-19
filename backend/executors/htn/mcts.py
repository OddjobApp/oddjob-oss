
"""
Monte Carlo Tree Search (MCTS) implementation.
"""

import math
import random

class Node:
    """A node in the search tree."""
    def __init__(self, state, parent=None):
        self.state = state
        self.parent = parent
        self.children = []
        self.visits = 0
        self.value = 0

class MCTS:
    """The MCTS algorithm."""
    def __init__(self, environment, world_model, exploration_weight=1.0):
        self.environment = environment
        self.world_model = world_model
        self.exploration_weight = exploration_weight

    def search(self, root_state, num_simulations):
        """Search for the best action from a given state."""
        root_node = Node(root_state)

        for _ in range(num_simulations):
            node = self._select(root_node)
            reward = self._simulate(node.state)
            self._backpropagate(node, reward)

        best_child = self._best_child(root_node)
        return best_child.state

    def _select(self, node):
        """Select a leaf node from the search tree."""
        while node.children:
            node = self._best_child(node)
        return node

    def _simulate(self, state):
        """Simulate a random rollout from a given state using the world model."""
        if not state:
            return 0

        from .representation import state_to_vector, action_to_vector

        # For simulation, we need to convert state and action to tensors
        state_tensor = state_to_vector(self.environment.state).unsqueeze(0).unsqueeze(0).float()
        action = state[0]
        action_tensor = action_to_vector(action).unsqueeze(0).unsqueeze(0).float()

        # Use the world model to predict the next state
        predicted_next_state_tensor = self.world_model.predict_next_state(state_tensor, action_tensor)

        # The reward is still determined by the environment for now.
        _, reward = self.environment.execute_action(action)

        return reward

    def _backpropagate(self, node, reward):
        """Backpropagate the reward up the search tree."""
        while node:
            node.visits += 1
            node.value += reward
            node = node.parent

    def _best_child(self, node):
        """Select the best child node using the UCB1 formula."""
        best_score = -float('inf')
        best_child = None

        for child in node.children:
            if child.visits == 0:
                return child

            score = child.value / child.visits + self.exploration_weight * math.sqrt(math.log(node.visits) / child.visits)

            if score > best_score:
                best_score = score
                best_child = child

        return best_child
