# Core Services: Knowledge Domain

## Overview

The `knowledge` domain contains the core services responsible for managing the platform's long-term memory and knowledge base. It provides the foundational capabilities for ingesting, indexing, chunking, embedding, and retrieving vast amounts of information, making it accessible to AI agents for Retrieval-Augmented Generation (RAG) and other knowledge-intensive tasks.

This domain ensures that the platform can learn from documents, user interactions, and external data sources, creating a persistent and searchable repository of information.

## Core Responsibilities

- **Knowledge Ingestion:** Provides services to ingest unstructured and structured data from various sources (e.g., PDFs, text files, web pages, database records).
- **Vectorization & Indexing:** Manages the process of chunking large documents, generating vector embeddings using models from the `ai` domain, and storing them in a specialized vector database for efficient similarity search.
- **Retrieval Services:** Offers high-level APIs for other domains (especially `agents`) to query the knowledge base using natural language. It translates queries into vector searches and returns the most relevant document chunks.
- **Knowledge Graph Management (Future):** Includes planned services for constructing and querying a knowledge graph to represent entities and relationships, enabling more sophisticated reasoning.
- **Source Management:** Keeps track of the provenance of all ingested data, ensuring that retrieved information can be traced back to its original source.

## Key Services

- **`knowledge-ingestion.service.ts`:** Handles the pipeline for processing and indexing new documents.
- **`knowledge-retrieval.service.ts`:** Provides the primary endpoint for agents to perform semantic searches over the indexed knowledge base.
- **`vector-store.service.ts`:** An abstraction layer that communicates with the underlying vector database (e.g., Pinecone, Chroma), handling the technical details of embedding storage and retrieval.

## Interactions with Other Domains

- **`ai`:** Relies heavily on the `ai` domain to access embedding models for vectorizing text.
- **`agents`:** Provides the critical `retrieve` tool that agents use to query for information to inform their reasoning and generate responses.
- **`integrations`:** Works with the `integrations` domain to pull data from external sources like Confluence, Jira, or file storage systems for ingestion.
- **`pipeline`:** Ingestion processes are often triggered as steps within a larger `pipeline`.
