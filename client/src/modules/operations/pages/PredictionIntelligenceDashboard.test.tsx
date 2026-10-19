import { describe, it, expect } from "vitest";
import * as dashboard from "./PredictionIntelligenceDashboard";
import {
    ZIP_CODE_DIRECTORY,
    findNearestZipOrCity,
    markersFromSignalEvents,
    getPropertyPhoto,
    getZillowSearchUrl,
    createSnapshotFromState,
    compareSnapshots,
    INITIAL_PRESET_SNAPSHOTS,
    generateDossierMarkdown,
    computeUnderwritingTrends,
    generateLoanTapeCsv,
    isSubjectToCandidate,
    DISTRESS_SIGNAL_CRITERIA,
} from "./PredictionIntelligenceDashboard";

/**
 * This module used to ship a hardcoded list of Orange County "distressed" homes
 * (addresses, APNs, Notice of Default and trustee-sale filings, lenders, loan
 * balances), a generator that invented three more on every map move, and
 * dossiers stamped "Verification: PASS". These tests pin the replacement: the
 * map plots real signal events, and every blank stays blank.
 *
 * Fixtures below are deliberately fictional ("1 Test Way").
 */
const recorded = {
    id: "custom-1",
    lat: 33.69,
    lng: -117.92,
    type: "distress" as const,
    label: "Test parcel",
    address: "1 Test Way, Costa Mesa, CA 92626",
    zip: "92626",
    apn: "000-000-00",
    badge: "Notice of Default",
    delinquencyAmount: "$10,000",
    estimatedValue: "$1.00M",
    remainingPrincipal: "$500k",
    interestRate: 3.1,
    ltv: 50,
    loanType: "30-Yr Fixed",
    purchaseDate: "2021-05-01",
};
const bare = { id: "custom-2", lat: 33.7, lng: -117.9, type: "distress" as const, label: "Unrecorded parcel" };

describe("ZIP geocoding", () => {
    it("knows Orange County and regional ZIP centroids", () => {
        expect(ZIP_CODE_DIRECTORY["92604"]?.city).toBe("Irvine");
        expect(ZIP_CODE_DIRECTORY["92626"]?.city).toBe("Costa Mesa");
        expect(ZIP_CODE_DIRECTORY["90210"]?.city).toBe("Beverly Hills");
    });

    it("finds the nearest ZIP for a coordinate", () => {
        expect(findNearestZipOrCity(33.684, -117.8075).zip).toBe("92604");
        expect(findNearestZipOrCity(33.689, -117.925).zip).toBe("92626");
        expect(findNearestZipOrCity(34.09, -118.406).zip).toBe("90210");
    });
});

describe("map markers come from real signal events", () => {
    it("plots events that carry a position, and only what they carry", () => {
        const markers = markersFromSignalEvents([
            { id: 7, latitude: 33.7, longitude: -117.9, title: "Port congestion", eventType: "logistics", jurisdiction: "US-CA" },
            { id: 8, latitude: null, longitude: null, title: "No position" },
            { id: 9, title: "Missing fields entirely" },
        ]);
        expect(markers).toHaveLength(1);
        expect(markers[0]).toMatchObject({ id: "evt-7", lat: 33.7, lng: -117.9, label: "Port congestion", badge: "logistics" });
        expect(markers[0]).not.toHaveProperty("apn");
        expect(markers[0]).not.toHaveProperty("lender");
    });

    it("returns nothing, not examples, when there is no data", () => {
        expect(markersFromSignalEvents(undefined)).toEqual([]);
        expect(markersFromSignalEvents([])).toEqual([]);
    });

    it("no longer exports the invented parcel list or generator", () => {
        expect(dashboard).not.toHaveProperty("OC_RESIDENTIAL_DISTRESS_MARKERS");
        expect(dashboard).not.toHaveProperty("generateProceduralDistressParcels");
        expect(dashboard).not.toHaveProperty("PROPERTY_PHOTO_CATALOG");
    });
});

describe("dossier and photos", () => {
    it("builds portal search links from an address", () => {
        const url = getZillowSearchUrl(recorded.address);
        expect(url).toContain("https://www.zillow.com/homes/");
        expect(url).toContain(encodeURIComponent(recorded.address));
    });

    it("shows a photo only when one was recorded", () => {
        expect(getPropertyPhoto(bare)).toBeUndefined();
        expect(getPropertyPhoto({ ...bare, photoUrl: "https://example.test/p.jpg" })).toBe("https://example.test/p.jpg");
    });

    it("fills no blanks and claims no verification", () => {
        const md = generateDossierMarkdown(bare);
        expect(md).not.toMatch(/PASS|Verified|Wells Fargo|\$1,250,000|Recorded Document #/);
        expect(md).toContain("Not recorded");
        expect(md).toContain("Entered by a user — unverified");
    });

    it("carries the values that were recorded", () => {
        const md = generateDossierMarkdown(recorded);
        expect(md).toContain(recorded.address);
        expect(md).toContain(recorded.apn);
        expect(md).toContain("3.1%");
    });
});

describe("snapshots", () => {
    it("starts with no pre-seeded history", () => {
        expect(INITIAL_PRESET_SNAPSHOTS).toEqual([]);
    });

    it("compares two snapshots the user took", () => {
        const before = createSnapshotFromState("before", [recorded], 33.7, -117.9, 11, "all", "all");
        const after = createSnapshotFromState("after", [recorded, { ...bare, badge: "Trustee sale auction" }], 33.7, -117.9, 11, "all", "all");
        const cmp = compareSnapshots(before, after);
        expect(cmp.parcelCountDelta).toBe(1);
        expect(cmp.newParcels.map((p) => p.id)).toEqual(["custom-2"]);
    });
});

describe("underwriting aggregates use recorded values only", () => {
    it("ignores missing rates and LTVs instead of defaulting them", () => {
        const trends = computeUnderwritingTrends([recorded, bare]);
        expect(trends.totalProperties).toBe(2);
        expect(trends.avgInterestRate).toBe(3.1); // not averaged with an invented 4.25%
        expect(trends.avgLTV).toBe(50); // not averaged with an invented 60%
        expect(trends.vintageDistribution).toEqual({ pre2020: 0, pandemicBoom: 1, rateShock: 0 });
        expect(trends.earliestPurchaseDate).toBe("2021-05-01");
        expect(trends.subjectToPrimeCandidates.map((m) => m.id)).toEqual(["custom-1"]);
    });

    it("reports N/A rather than invented dates for an empty list", () => {
        const trends = computeUnderwritingTrends([]);
        expect(trends.earliestPurchaseDate).toBe("N/A");
        expect(trends.avgLTV).toBe(0);
    });

    it("needs both rate and LTV to call a subject-to candidate", () => {
        expect(isSubjectToCandidate(recorded)).toBe(true);
        expect(isSubjectToCandidate(bare)).toBe(false);
        expect(isSubjectToCandidate({ ...bare, interestRate: 2.5 })).toBe(false);
    });

    it("marks subject-to UNKNOWN in the loan tape when inputs are missing", () => {
        const [, first, second] = generateLoanTapeCsv([recorded, bare]).split("\n");
        expect(first.endsWith(",YES")).toBe(true);
        expect(second.endsWith(",UNKNOWN")).toBe(true);
    });
});

describe("distress signal criteria matchers", () => {
    it("defines the five expected distress signal criteria", () => {
        const ids = DISTRESS_SIGNAL_CRITERIA.map((c) => c.id);
        expect(ids).toEqual(["nod", "auction", "tax", "substandard", "probate"]);
    });

    it("correctly identifies Notice of Default signals", () => {
        const nod = DISTRESS_SIGNAL_CRITERIA.find((c) => c.id === "nod")!;
        expect(nod.matcher("Notice of Default")).toBe(true);
        expect(nod.matcher("Default notice recorded")).toBe(true);
        expect(nod.matcher("Delinquent Property Taxes")).toBe(false);
    });

    it("correctly identifies Scheduled Trustee Auction signals", () => {
        const auction = DISTRESS_SIGNAL_CRITERIA.find((c) => c.id === "auction")!;
        expect(auction.matcher("Scheduled Trustee Auction")).toBe(true);
        expect(auction.matcher("Trustee sale")).toBe(true);
        expect(auction.matcher("Probate case")).toBe(false);
    });

    it("correctly identifies Delinquent Tax signals", () => {
        const tax = DISTRESS_SIGNAL_CRITERIA.find((c) => c.id === "tax")!;
        expect(tax.matcher("Delinquent property tax lien")).toBe(true);
        expect(tax.matcher("Notice of Default")).toBe(false);
    });

    it("correctly identifies Substandard / Red-Tag signals", () => {
        const substandard = DISTRESS_SIGNAL_CRITERIA.find((c) => c.id === "substandard")!;
        expect(substandard.matcher("Substandard housing violation")).toBe(true);
        expect(substandard.matcher("Red-tag notice posted")).toBe(true);
        expect(substandard.matcher("Trustee sale")).toBe(false);
    });

    it("correctly identifies Probate Acceleration signals", () => {
        const probate = DISTRESS_SIGNAL_CRITERIA.find((c) => c.id === "probate")!;
        expect(probate.matcher("Probate case opened")).toBe(true);
        expect(probate.matcher("Notice of Default")).toBe(false);
    });

    it("supports multi-selection match logic across signals", () => {
        const parcels = [
            { id: "1", badge: "Notice of Default" },
            { id: "2", badge: "Trustee Auction Scheduled" },
            { id: "3", badge: "Delinquent County Taxes" },
            { id: "4", badge: "Red-tag substandard" },
            { id: "5", badge: "Probate estate" },
        ];

        // "all" matches all 5
        const allMatches = parcels.filter((p) => {
            const selectedSignals = ["all"];
            if (selectedSignals.includes("all")) return true;
            return false;
        });
        expect(allMatches.length).toBe(5);

        // Subset: ["nod", "probate"] matches 2
        const subsetSignals = ["nod", "probate"];
        const subsetMatches = parcels.filter((p) => {
            const badgeLower = p.badge.toLowerCase();
            return subsetSignals.some((sigId) => {
                const crit = DISTRESS_SIGNAL_CRITERIA.find((c) => c.id === sigId);
                return crit ? crit.matcher(badgeLower) : false;
            });
        });
        expect(subsetMatches.map((p) => p.id)).toEqual(["1", "5"]);

        // Empty selection matches 0
        const emptySignals: string[] = [];
        const emptyMatches = parcels.filter(() => {
            if (emptySignals.length === 0) return false;
            return true;
        });
        expect(emptyMatches.length).toBe(0);
    });
});

