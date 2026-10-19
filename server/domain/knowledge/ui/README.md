# UI Module: Knowledge

## Overview

The Knowledge UI module provides the front-end components for managing the platform's knowledge base. It allows users to upload, view, and organize the documents and data that AI agents use for Retrieval-Augmented Generation (RAG).

This module is the user's window into the data managed by the `knowledge/core` services.

## Key Features & Components

- **Document Uploader:** A component that allows users to upload files (e.g., PDFs, TXT, Markdown) to be ingested into the knowledge base.
- **Knowledge Base Explorer:** A file-explorer-like interface where users can browse the ingested documents, organize them into folders, and view their ingestion status.
- **Document Viewer:** An interface to view the content of an ingested document. It may also show how the document was chunked and allow users to see the vector embeddings for each chunk.
- **Semantic Search Interface:** A search bar where users can type natural language queries to test the retrieval capabilities of the knowledge base, seeing which document chunks are returned for a given query.

## Data Flow

The Document Uploader sends files to an API endpoint that kicks off the ingestion process managed by `knowledge-ingestion.service.ts`. The Knowledge Base Explorer fetches its data from the `knowledge` API to list documents and their statuses. The Semantic Search Interface interacts with the `knowledge-retrieval.service.ts` to perform queries and display the results.
