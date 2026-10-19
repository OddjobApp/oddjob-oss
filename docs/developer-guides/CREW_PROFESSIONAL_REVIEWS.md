# CREW professional reviews

`render_performance_scorecard` and `render_gate_review` produce validated artifacts
that CREW stores with the turn and renders through `CrewReviewCard`. These are
read-safe presentation tools. They never approve a decision, change a project
stage, disburse funds, or deploy anything.

## Pilot templates

`vendor_performance` uses the critical-vendor weighting profile: reliability 30,
quality 25, commercial performance 20, and service 25. Its mandatory criteria are
current certifications, no unresolved security incidents, and privacy compliance.

`project_phase_gate` weights deliverables 35, technical verification 30,
operational readiness 20, and business case 15. Mandatory criteria cover critical
security findings, recorded architecture approval, and at least 90% mandatory
deliverable completion. This template belongs to `render_gate_review`.

Exact labels and weights are exported in `CREW_REVIEW_TEMPLATES` in
`shared/crew-review.ts`; the tools include them in their descriptions and enforce
them during execution. Use `custom` for other weighting profiles.

## Evidence and scoring

Each review requires a title, summary, period, methodology version, and criteria.
Each criterion includes a 0–100 score (or null), positive relative weight, and
evidence text. Gate states are `pass`, `fail`, or `unknown`, with evidence text.
Include optional recommended actions with owner and due date when known.

Scores are supplied from an identified methodology and source measurements;
these tools do not implement or certify the attached domain scoring formulas.
Never manufacture a score from unavailable telemetry. Null withholds the
composite, and unknown gates produce "Needs evidence". Any failed gate produces
"Blocked", regardless of the weighted score. Complete evidence yields "Ready for
review", never an approval or executed-action status.

The card exposes evidence and weighting in an expandable section. Malformed
persisted payloads show an explicit unavailable message. No new storage table or
migration is required: the existing turn artifact path carries the payload.
