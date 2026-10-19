
"""
Procedural memory for the agent.
"""

class ProceduralMemory:
    """A simple placeholder for a skill library that would store the agent's executable skills and plans."""

    def __init__(self):
        self.skill_library = {}

    def add_skill(self, name, skill):
        """Add a new skill to the library."""
        self.skill_library[name] = skill

    def get_skill(self, name):
        """Get a skill from the library."""
        return self.skill_library.get(name)
