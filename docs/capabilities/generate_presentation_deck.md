# 📊 Generate Presentation Deck
> **Capability ID**: `generate_presentation_deck`
> **Capability Version**: `2.0.0`
> **Manifest Schema Version**: `1`
> **Category**: `Generation`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

Assembles high-fidelity visual presentation deliverables (slide decks, magazine ads, whitepapers, executive briefs) using Oddjob's 4-agent creative crew (Information Architect, Data Storyteller, Art Director, Brand Guardian) and an atomic block layout engine with theme-aware design systems, interactive visual blocks (`ChartBlock`, `DiagramBlock`), and verifiable Knowledge Graph provenance citations.

---

### Inputs

| Name | Type | Description |
|---|---|---|
| `title` | `string` | Title of the presentation deliverable |
| `content` | `string` | Raw markdown, JSON, or structured text content to distill into presentation blocks |
| `themeId` | `enum` | Design system theme (`dark_cyberpunk`, `glass_corporate`, `editorial_magazine`, `vibrant_product`, `clean_minimalist`) |
| `formatCategory` | `enum` | Output document format category (`presentation_deck`, `magazine_ad`, `whitepaper`, `executive_brief`) |
| `sourceQuery` | `object` | Optional saved query lineage metadata (`id`, `name`) |

---

### Supported Document Block Types

1. **`hero_header`**: Cover banner with large bold headline, badge, subheadline, and CTA action.
2. **`slide_frame`**: Presentation slide frame with headline, body narrative, bullet points, and speaker notes.
3. **`magazine_ad`**: Editorial layout with pull quote, author attribution, and supporting feature points.
4. **`feature_grid`**: Card grid layout with 2 to 4 capability cards with badges and descriptions.
5. **`stat_callout`**: KPI metric callout cards with delta percentages and positive/negative indicators.
6. **`comparison_matrix`**: Feature comparison matrix table with our advantages vs competitor alternatives.
7. **`timeline`**: Milestone timeline with status indicators (`completed`, `active`, `upcoming`).
8. **`chart`**: Data visualization bar, line, pie, doughnut, or radar chart with datasets and units.
9. **`diagram`**: Architecture and workflow diagram rendered with Mermaid code syntax.

---

### Knowledge Graph Citations & Provenance

Every block optionally includes:
- **`citations`**: Array of entity citations (`entityName`, `entityType`, `sourceQueryId`, `confidenceScore`) rendered as interactive badge chips.
- **`provenance`**: Provenance metadata (`source`, `verified`, `timestamp`) indicating data lineage.

---

### Outputs

| Name | Type | Description |
|---|---|---|
| `result` | `string` | JSON stringified `presentation_deck` artifact with AST, block count, theme, lineage, and summary. |

---

### Business Use Cases

*   **Executive Boardroom Decks**: Generating sleek presentations for leadership review.
*   **Tactical Incident Briefings**: Delivering visual summaries of multi-agent operations and incident resolution.
*   **Architecture & Capability Overviews**: Illustrating system workflows with automated Mermaid diagrams and chart telemetry.
