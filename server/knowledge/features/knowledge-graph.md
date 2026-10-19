# Knowledge Graph Feature

## Overview
The knowledge graph stores entities and their relationships, enabling impact analysis and organizational knowledge management.

## Entity Types
- **Component**: Software components, services
- **Infrastructure**: Servers, databases, cloud resources
- **User**: Team members, stakeholders
- **Ticket**: Issues, tasks from external systems
- **Dataset**: Data collections
- **Process**: Business processes

## Relationship Types
- `DEPENDS_ON`: Entity A depends on Entity B
- `OWNS`: Entity A owns/maintains Entity B
- `RELATED_TO`: Generic relationship
- `MAINTAINS`: Team/user maintains entity
- `CONTAINS`: Parent contains child
- `TRIGGERS`: Action triggers another

## Common Operations

### Search Entities
Find entities by name, type, or properties.
```
search_knowledge_graph("Payment Service", entityType: "Component")
```

### Impact Analysis
Understand what depends on an entity before making changes.
```
get_entity_impact("Database Cluster A", direction: "inbound")
```

### Create Entity
Add new entities to the graph.
```
create_entity(name: "New API Gateway", entityType: "Component")
```

### Create Relationship
Link entities together.
```
create_relationship(
  sourceEntityName: "Frontend App",
  targetEntityName: "API Gateway",
  relationType: "DEPENDS_ON"
)
```

## Use Cases

### Before Making Changes
1. Use `get_entity_impact` to find dependencies
2. Identify affected services/teams
3. Plan rollback strategy

### Exploring the Codebase
1. Search for components by name
2. View relationships to understand architecture
3. Find owners for questions

### Incident Response
1. Search for affected entities
2. Trace dependencies to find root cause
3. Identify all impacted systems

## User Help Scenarios

| Scenario | Response |
|----------|----------|
| "What depends on X?" | Use get_entity_impact with direction: inbound |
| "Show me the architecture" | Search components, show relationships |
| "Add new service" | Use create_entity, then create_relationship |
