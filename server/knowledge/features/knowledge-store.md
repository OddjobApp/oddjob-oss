# Knowledge Store

The Knowledge Store is a centralized repository for organizational knowledge, structured as **Topics** (categories) containing **Documents** (files, text snippets, or links).

## Data Model

### Topics
- Categories for grouping related documents
- Can have parent-child hierarchy
- Jobs reference topics via `config.retrievalSettings.topicIds`

### Documents
- Source types: `upload` (files), `link` (URLs), `text` (snippets)
- Indexed in Qdrant vector database for semantic search
- Can belong to multiple topics via `knowledge_topic_documents` join table

## Relationships

### Topic → Jobs
Jobs with AI/RAG capabilities can specify `retrievalSettings.topicIds` to retrieve knowledge from specific topics:
```json
{
  "retrievalSettings": {
    "topicIds": [1, 3],
    "k": 5
  }
}
```

### Document → Knowledge Graph
Extracted entities link back to source documents via `knowledge_graph_nodes.knowledge_document_id`.

## Available Tools

- `search_knowledge_base`: Semantic search across indexed documents
- `get_document_relationships`: Find jobs, pipelines, datasets linked to topics/documents

## URL Patterns

When referencing resources, use these URL formats:
- Jobs: `/jobs/{id}`
- Pipelines: `/pipelines/{id}`
- Knowledge Graph entity: `/knowledge/graph?entity={id}`
- Topic/Document: `/knowledge-store` (no deep links yet)

## Common User Questions

1. "What jobs use this topic?" → Use `get_document_relationships(topicName: "X")`
2. "Summarize this document" → Use `search_knowledge_base(query: "title")`
3. "What pipelines use Tickets knowledge?" → Use `get_document_relationships(topicName: "Tickets")`
