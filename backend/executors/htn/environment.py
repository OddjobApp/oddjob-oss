
"""
A simple environment simulator that mimics the behavior of a web browser.
"""

from .state import WorldState

class BrowserEnvironment:
    """Simulates a web browser environment."""

    def __init__(self, initial_state: WorldState):
        self.state = initial_state

    def execute_action(self, action) -> tuple[WorldState, float]:
        """Executes an action and returns the new state and reward."""
        new_state = self.state.copy()
        reward = -0.1  # Small penalty for each action to encourage efficiency

        if action.name == "open_browser":
            if not new_state.is_browser_open:
                new_state.is_browser_open = True
                reward = 0.2
        elif action.name == "type_url":
            if new_state.is_browser_open:
                # In a real scenario, we'd get the URL from the action parameters
                new_state.current_url = "http://example.com"
                reward = 0.3
        elif action.name == "press_enter":
            if new_state.current_url:
                # Simulate a chance of failure
                import random
                if random.random() > 0.5:
                    new_state.page_content = f"<html><body>Welcome to {new_state.current_url}</body></html>"
                    reward = 1.0  # Goal achieved
                else:
                    new_state.page_content = "<html><body>404 Not Found</body></html>"
                    reward = -1.0 # Goal failed

        self.state = new_state
        return self.state, reward
