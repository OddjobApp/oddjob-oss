# Presentation Crew & Document Layout Engine

## Overview
Oddjob features a native **Presentation Crew & Document Layout Engine** (`presentation-crew.service.ts`) capable of laying out documents, generating high-quality slide decks, and synthesizing interactive visual presentations from raw markdown or text inputs.

## Capabilities & Format Categories
The engine supports four core deliverable formats:
1. **Presentation Decks** (`presentation_deck`): High-impact, multi-slide presentations with grid layouts, metric callouts, and hero visuals.
2. **Executive Briefs** (`executive_brief`): Dense, structured executive documentation with key metric cards and action items.
3. **Whitepapers** (`whitepaper`): Multi-section technical reports with embedded code blocks, charts, and diagrams.
4. **Magazine Ads & Graphics** (`magazine_ad`): Styled hero promotional layouts requiring human-in-the-loop (HIL) sign-off.

## 4-Agent Creative Pipeline
The presentation crew orchestrates four specialist agent personas:
- **Information Architect**: Distills raw input into structured `DocumentBlockAST` nodes.
- **Data Storyteller**: Extracts key quantitative metrics and builds responsive card grids.
- **Art Director**: Applies curated color palettes, typography, and synthesizes theme-matched hero images.
- **Brand Guardian**: Verifies WCAG contrast standards, brand compliance, and mounts HIL approval gates.

## Usage
The engine is invoked via `presentationCrewService.orchestrateCreativeCrew(rawInput, options)` or through the Presentation & Document Layout tool capabilities.
