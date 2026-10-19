# Knowledge Graph MCP Tools

## Search & Query

### search_knowledge_graph
Find entities and relationships.
```
search_knowledge_graph(
  query: string,                    // Search term
  entityType?: string,              // Filter by type (Component, User, etc.)
  includeRelationships?: boolean,   // Include connected entities
  limit?: number                    // Max results (default: 20)
)
```

### get_entity_impact
Analyze dependencies.
```
get_entity_impact(
  entityName: string,
  entityType?: string,              // Disambiguate if needed
  direction?: "inbound" | "outbound" | "both"
)
```
- `inbound`: What depends on this entity
- `outbound`: What this entity depends on
- `both`: All connections

### get_graph_statistics
Get graph overview.
```
get_graph_statistics()
```
Returns: Entity counts by type, relationship counts, recent activity

## Create & Modify

### create_entity
Add entity to graph.
```
create_entity(
  name: string,
  entityType: string,
  properties?: object,
  externalId?: string
)
```

### create_relationship
Link two entities.
```
create_relationship(
  sourceEntityName: string,
  targetEntityName: string,
  relationType: string  // DEPENDS_ON, OWNS, MAINTAINS, RELATED_TO
)
```

### suggest_schema
Generate ontology from description.
```
suggest_schema(domainDescription: string)
```

## Usage Patterns

### Impact Analysis Before Change
```
get_entity_impact("Database Cluster A", direction: "inbound")
// Shows all services/components that depend on this database
```

### Building Component Map
```
create_entity("API Gateway", "Component")
create_entity("Frontend App", "Component")
create_relationship("Frontend App", "API Gateway", "DEPENDS_ON")
```
