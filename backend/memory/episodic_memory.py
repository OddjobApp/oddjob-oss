
"""
Episodic memory for the agent.
"""

class EpisodicMemory:
    """A simple in-memory store for the agent's recent experiences."""

    def __init__(self):
        self.experiences = []

    def add_experience(self, experience):
        """Add a new experience to the memory."""
        self.experiences.append(experience)

    def get_recent_experiences(self, num_experiences):
        """Get the most recent experiences from the memory."""
        return self.experiences[-num_experiences:]
