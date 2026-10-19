---
id: unstructured-document-parsing
title: Multimodal Document Parsing, Markdown AST & Table Extraction Standards
audience: [HUMAN_PRIMARY, AGENT_PRIMARY, HYBRID]
badge: AGENT_PRIMARY
category: 02-problem-resolution-patterns
autonomy_level: L2-L3
version: 2.0.0
tags: [document-parsing, pdf, markdown, ast, chunking, vision, ocr, tables, rag]
summary: Standards for parsing complex PDFs, Word documents, and spreadsheets into structured Markdown ASTs, preserving table grid topologies and bounding-box coordinates for Multimodal LLMs.
verification_status: verified
applies_when:
  - Ingesting complex multi-page PDF documents, financial tables, forms, or scanned images
  - Converting unstructured binary documents into chunked vector embeddings
  - Preserving table structures, headers, and hierarchical headings in Markdown
do_not_use_when:
  - Ingesting well-structured native JSON payloads from REST APIs
required_tools:
  - pdf_extract_text
  - pdf_extract_metadata
  - vision_analyze
  - vision_extract_text
preconditions:
  - Source document accessible via local filepath or signed URL
  - Target document size $\le 50\text{MB}$ and page count $\le 250\text{ pages}$
approval_requirements:
  - None for standard read-only document ingestion
success_checks:
  - Document successfully chunked into overlapping windows ($512\text{ tokens}$ with $10\%$ overlap)
  - Tables converted to valid GitHub-flavored Markdown grid tables without column misalignment
stop_conditions:
  - Corrupted binary file or password-protected PDF without provided decryption key
escalation:
  - Route password-protected or unparseable scanned documents to HIL Document Remediation queue
implementation_evidence:
  - server/domain/media/
  - server/domain/knowledge/
---

# Multimodal Document Parsing & Table Extraction `[🤖 AGENT]`

> **Audience:** `🤖 Agent Executable & Document Ingestion Specialist` &nbsp;|&nbsp; **Classification:** Extraction & Normalization Pattern

---

## 1. Document Extraction & AST Normalization Pipeline `[🧑 Human]`

Unstructured documents (PDFs, PPTX, DOCX, XLSX) pass through a dual-track extraction engine to produce semantic Markdown ASTs:

```mermaid
graph TD
    InputDoc["Input Document (PDF / DOCX / Scanned Image)"]

    subgraph Track1["Track 1: Digital Text Extraction"]
        DigitalText["Text Stream Extractor + Font Size & Heading Hierarchy"]
    end

    subgraph Track2["Track 2: Vision & OCR Table Recognizer"]
        VisionOCR["Multimodal Vision Model (Table Grid & Diagram OCR)"]
    end

    subgraph ASTAssembler["Markdown AST Reconstruction"]
        MergeLayout["Layout Hierarchy Assembler (# Heading 1 -> ## Heading 2)"]
        TableFormatter["GFM Markdown Table Generator"]
    end

    subgraph ChunkingPipeline["Semantic Chunking Pipeline"]
        Chunker["512-Token Window Chunker (10% Semantic Overlap)"]
        VectorEmbed["HNSW Dense Vector Embedder"]
    end

    InputDoc --> Track1 & Track2
    Track1 & Track2 --> ASTAssembler
    ASTAssembler --> ChunkingPipeline
```

---

## 2. Table Preservation & Grid Invariants `[🤖 Agent Reference]`

Financial and technical tables must NEVER be flattened into raw unaligned text streams.

### Standard Conversion Rules:
1. **GitHub-Flavored Markdown Tables:** Always convert detected tabular data into standard GFM tables with header separators:
   ```markdown
   | Metric Name | Q1 2026 Actual | Q2 2026 Target | Variance (%) |
   | :--- | :--- | :--- | :--- |
   | ARR Growth | $12.4M | $14.0M | -11.4% |
   | Gross Margin | 78.2% | 80.0% | -2.25% |
   ```
2. **Merged Cells Handling:** For multi-column headers, repeat the parent category label in child columns (e.g. `Revenue (Americas) | Revenue (EMEA)`).
3. **Footnotes & Disclaimers:** Append table footnotes directly below the table blockquote.

---

## 3. Semantic Chunking Strategy `[🤖 Agent Reference]`

When dividing normalized documents for vector indexing:

- **Chunk Size:** `512 tokens` (optimal balance between context density and retrieval precision).
- **Chunk Overlap:** `50 tokens (10%)` to prevent splitting sentences or equations at chunk boundaries.
- **Section Boundary Respect:** Never split across `# Heading 1` or `## Heading 2` boundaries if the section fits within a single chunk.
- **Metadata Ingestion:** Every chunk must retain `sourceDocumentId`, `pageNumber`, and `headingBreadcrumb` (e.g. `"Financials > Balance Sheet > Liabilities"`).
