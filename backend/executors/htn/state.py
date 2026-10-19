
"""
Defines the state representation for the agent's environment.
"""

from typing import Optional

class WorldState:
    """
    Represents the state of the world from the agent's perspective.
    """

    def __init__(
        self,
        is_browser_open: bool = False,
        current_url: Optional[str] = None,
        page_content: Optional[str] = None
    ):
        self.is_browser_open = is_browser_open
        self.current_url = current_url
        self.page_content = page_content

    def __repr__(self):
        return f"WorldState(browser_open={self.is_browser_open}, url='{self.current_url}')"

    def copy(self):
        """Creates a copy of the current state."""
        return WorldState(
            is_browser_open=self.is_browser_open,
            current_url=self.current_url,
            page_content=self.page_content
        )
