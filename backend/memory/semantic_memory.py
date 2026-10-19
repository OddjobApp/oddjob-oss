
"""
Semantic memory for the agent.
"""

class SemanticMemory:
    """A simple placeholder for a semantic memory that would be backed by a graph database."""

    def __init__(self):
        self.knowledge_graph = {}

    def add_fact(self, subject, relation, obj):
        """Add a new fact to the knowledge graph."""
        if subject not in self.knowledge_graph:
            self.knowledge_graph[subject] = {}
        self.knowledge_graph[subject][relation] = obj

    def get_related_facts(self, subject, relation):
        """Get related facts from the knowledge graph."""
        if subject in self.knowledge_graph and relation in self.knowledge_graph[subject]:
            return self.knowledge_graph[subject][relation]
        return None
