/** Shared OCEAN personality trait labels used across job and app publish UIs. */
export const OCEAN_LABELS: Record<string, { label: string; low: string; high: string }> = {
    o: { label: "Openness",           low: "Conventional", high: "Inventive"   },
    c: { label: "Conscientiousness",  low: "Flexible",     high: "Disciplined" },
    e: { label: "Extraversion",       low: "Reserved",     high: "Outgoing"    },
    a: { label: "Agreeableness",      low: "Competitive",  high: "Cooperative" },
    n: { label: "Neuroticism",        low: "Stable",       high: "Reactive"    },
};

/** Canonical list of named soul archetypes available for agent personality configuration. */
export const SOUL_ARCHETYPES: string[] = [
    "Lead Directive",
    "Strategic Oracle",
    "Field Operative",
    "Tactical Analyst",
    "Creative Catalyst",
    "Data Sentinel",
    "Crisis Commander",
    "Knowledge Architect",
    "Process Engineer",
    "Innovation Director",
];
