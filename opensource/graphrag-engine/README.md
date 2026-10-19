# GraphRAG Engine

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![npm version](https://badge.fury.io/js/@oddjob%2Fgraphrag-engine.svg)](https://badge.fury.io/js/@oddjob%2Fgraphrag-engine)

> **Hybrid Graph + Vector Retrieval Augmented Generation**

GraphRAG Engine combines knowledge graphs with vector embeddings for superior retrieval performance. It powers the Oddjob AI platform's knowledge management system and is now available as open source.

## Features

- 🔗 **Knowledge Graph Integration** - Connect entities and relationships
- 🔍 **Hybrid Search** - Combine vector similarity with graph traversal
- 📊 **Path Explainer** - Explain connections between entities
- ⚡ **Sub-100ms Latency** - Production-grade performance
- 🔄 **Real-time Updates** - Dynamic graph updates as documents change
- 🎯 **Multi-modal Support** - Text, images, and structured data

## Quick Start

```bash
npm install @oddjob/graphrag-engine
```

```typescript
import { GraphRAGService } from '@oddjob/graphrag-engine';

const graphRAG = new GraphRAGService({
  qdrantUrl: 'http://localhost:6333',
  collectionName: 'my-knowledge-base'
});

// Index a document
await graphRAG.indexDocument({
  id: 'doc-1',
  content: 'GraphRAG combines vector search with knowledge graphs.',
  metadata: { source: 'documentation' }
});

// Query with hybrid search
const results = await graphRAG.hybridSearch({
  query: 'How does GraphRAG work?',
  topK: 5,
  graphDepth: 2
});

console.log(results);
```

## Architecture

```
┌─────────────────────────────────────────────┐
│           GraphRAG Engine                   │
├─────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Vector  │  │  Graph   │  │  Hybrid  │  │
│  │  Search  │  │ Traversal│  │  Merge   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│       │              │              │        │
│       └──────────────┼──────────────┘        │
│                      │                       │
│              ┌───────▼───────┐               │
│              │   Results     │               │
│              └───────────────┘               │
└─────────────────────────────────────────────┘
```

## API Reference

### GraphRAGService

Main service class for hybrid graph + vector search operations.

#### Constructor

```typescript
new GraphRAGService(config: GraphRAGConfig)
```

**Parameters:**
- `qdrantUrl`: URL to Qdrant vector database
- `collectionName`: Name of the vector collection
- `graphConfig`: Optional graph database configuration

#### Methods

##### `indexDocument(document: Document): Promise<void>`

Index a document into the knowledge base, extracting entities and relationships.

##### `hybridSearch(query: HybridQuery): Promise<SearchResult[]>`

Perform hybrid search combining vector similarity and graph traversal.

##### `explainPath(from: string, to: string): Promise<PathExplanation>`

Explain the relationship path between two entities.

##### `traverseGraph(startNode: string, depth: number): Promise<GraphTraversal>`

Traverse the knowledge graph starting from a node.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Apache License 2.0 - see [LICENSE](LICENSE) file for details.

## Community

- GitHub: https://github.com/oddjob-ai/graphrag-engine
- Discord: https://discord.gg/oddjob
- Documentation: https://docs.oddjob.ai/graphrag

## Acknowledgments

GraphRAG Engine was originally developed by Oddjob AI, Inc. as part of the Oddjob AI platform.

## Roadmap

- [x] Core hybrid search
- [x] Path explanation
- [x] Real-time graph updates
- [ ] Multi-modal embeddings
- [ ] Distributed graph processing
- [ ] GraphQL API layer
