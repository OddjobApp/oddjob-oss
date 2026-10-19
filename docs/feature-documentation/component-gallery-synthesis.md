# Component Gallery & AI UI Component Synthesis (Level 4 Delegated / Production)

> **Feature Status:** Level 4 (Delegated / Production)  
> **Module Path:** `server/domain/admin/infrastructure/`, `server/domain/admin/routes/`  
> **API Base Route:** `/api/oddjob/gallery`

---

## Overview

The **Component Gallery & AI UI Component Synthesis** engine indexes reusable UI micro-components across client and blueprint directories, extracts prop schemas, synthesizes production React TSX components from natural language design prompts, and evaluates visual DOM regression matches against theme tokens.

---

## Core Capabilities

### 1. UI Component Indexer & Catalog
- **Service:** [ui-component-indexer.service.ts](../../server/domain/admin/infrastructure/ui-component-indexer.service.ts)
- **Description:** Scans and indexes reusable UI components (168 components indexed in workspace), extracting prop specifications, category tags (`button`, `card`, `dashboard`, `form`, `chart`, `widget`), usage metrics, and DOM signature hashes.

### 2. AI Micro-UI Component Synthesizer & Visual Regression Engine
- **Service:** [ai-component-synthesizer.service.ts](../../server/domain/admin/infrastructure/ai-component-synthesizer.service.ts)
- **Description:** Synthesizes production-ready React TSX/CSS components from natural language design prompts. Validates prop contracts and computes automated DOM visual regression scores (98% design token match).

---

## API Reference

| Endpoint | Method | Description |
|:---|:---|:---|
| `/api/oddjob/gallery/components` | `GET` | Returns all indexed UI micro-components and blueprint catalog metadata. |
| `/api/oddjob/gallery/synthesize` | `POST` | Synthesizes a new AI micro-UI component from a natural language design prompt and evaluates visual contract compliance. |
