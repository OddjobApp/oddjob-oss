import { describe, it, expect, vi } from "vitest";
import { ScribeCopilotService } from "../core/scribe-copilot.service.js";

describe("ScribeCopilotService (In-Pod Custodian)", () => {
    const service = new ScribeCopilotService();

    it("parses numbered outlines cleanly into station nodes", () => {
        const text = `
**Shelfie Product Requirements Document - Table of Contents**

1.  **Introduction**
    *   1.1 Purpose
2.  **User Personas & Stories**
    *   2.1 Target Users
3.  **Functional Requirements**
    *   3.1 Inventory Tracking
4.  **Data Model & Schema (SME: Analyst)**
    *   4.1 Core Entities
5.  **Non-Functional Requirements**
6.  **Technical Architecture (SME: Copilot)**
7.  **Future Considerations**
8.  **Open Questions & Assumptions**
`;

        const stations = service.parseOutlineToStations(text);
        expect(stations.length).toBe(8);
        expect(stations[0].title).toBe("1. Introduction");
        expect(stations[0].sortOrder).toBe(1);
        expect(stations[0].stationKey).toBe("introduction");

        expect(stations[1].title).toBe("2. User Personas & Stories");
        expect(stations[2].title).toBe("3. Functional Requirements");
        expect(stations[3].title).toBe("4. Data Model & Schema");
        expect(stations[4].title).toBe("5. Non-Functional Requirements");
        expect(stations[5].title).toBe("6. Technical Architecture");
        expect(stations[6].title).toBe("7. Future Considerations");
        expect(stations[7].title).toBe("8. Open Questions & Assumptions");
    });

    it("handles alternative formats with clean deduplication", () => {
        const text = `
1. Executive Summary
2. Problem Statement
3. Solution & Architecture
4. Implementation Roadmap
5. Risks & Mitigations
`;
        const stations = service.parseOutlineToStations(text);
        expect(stations.length).toBe(5);
        expect(stations.map(s => s.stationKey)).toEqual([
            "executive_summary",
            "problem_statement",
            "solution_architecture",
            "implementation_roadmap",
            "risks_mitigations",
        ]);
        expect(stations[0].targetPercentage).toBe(0.2);
    });
});
