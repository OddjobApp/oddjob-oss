/**
 * Product Launch Cycle — Seed Data
 *
 * Populates initial datasets when the cycle is installed into an org.
 * Provides sample competitive intelligence, personas, and past launches
 * so the workbenches aren't empty on first load.
 */

export const SEED_DATA = {
  competitive_intelligence: [
    {
      name: "CompetitorAlpha",
      positioning: "Enterprise-first platform with deep integrations",
      strengths: ["Enterprise sales team", "SOC 2 certified", "Large partner ecosystem"],
      weaknesses: ["Slow to ship features", "Complex onboarding", "Expensive"],
      market_share: 35,
      pricing: "$99-499/seat/month",
      recent_launches: [{ name: "AI Assistant", date: "2026-03", reception: "mixed" }],
    },
    {
      name: "CompetitorBeta",
      positioning: "Developer-first tool with API-centric approach",
      strengths: ["Great DX", "Fast iteration", "Strong community"],
      weaknesses: ["No enterprise features", "Limited support", "Single-player focused"],
      market_share: 20,
      pricing: "$29-149/seat/month",
      recent_launches: [{ name: "Team Workspaces", date: "2026-01", reception: "positive" }],
    },
    {
      name: "CompetitorGamma",
      positioning: "All-in-one suite for mid-market teams",
      strengths: ["Bundled pricing", "Easy migration", "Good mobile app"],
      weaknesses: ["Jack of all trades", "Mediocre at each function", "Vendor lock-in"],
      market_share: 15,
      pricing: "$49-199/seat/month",
      recent_launches: [],
    },
  ],

  customer_personas: [
    {
      name: "Strategic Sarah",
      role: "VP of Product",
      pain_points: ["Can't get visibility across teams", "Launches always slip", "No single source of truth"],
      buying_triggers: ["Missed launch deadline", "Board pressure on velocity", "Competitor launched first"],
      channels: ["LinkedIn", "Industry conferences", "Peer recommendations"],
      budget_authority: true,
      decision_criteria: ["ROI within 6 months", "Team adoption rate", "Integration with existing tools"],
    },
    {
      name: "Technical Tom",
      role: "Engineering Manager",
      pain_points: ["Context switching between tools", "Unclear requirements from product", "Last-minute scope changes"],
      buying_triggers: ["Team burnout from launch chaos", "Need for automation", "Developer experience matters"],
      channels: ["Hacker News", "GitHub", "Dev podcasts", "Twitter/X"],
      budget_authority: false,
      decision_criteria: ["API quality", "Developer experience", "No vendor lock-in"],
    },
    {
      name: "Marketing Maya",
      role: "Head of Marketing",
      pain_points: ["Content bottleneck", "Can't measure campaign ROI", "Sales and marketing misaligned"],
      buying_triggers: ["Scaling content production", "Attribution challenges", "New product launch upcoming"],
      channels: ["Marketing podcasts", "LinkedIn", "Industry reports", "Peer communities"],
      budget_authority: true,
      decision_criteria: ["Time saved per launch", "Content quality", "Integration with marketing stack"],
    },
  ],

  past_launches: [
    {
      product_name: "Widget Pro 2.0",
      launch_date: "2025-09-15",
      outcome: "exceeded_targets",
      metrics: { signups_day1: 450, conversion_rate: 12, nps: 52, revenue_month1: 85000 },
      lessons_learned: "Early beta feedback was critical. Sales enablement 3 weeks before launch made a huge difference. Social content performed 3x better than paid.",
      what_worked: ["Beta program with 50 users", "Sales certification program", "Influencer partnerships"],
      what_didnt: ["Press release timing (too early)", "Landing page was too long", "Email sequence had too many steps"],
    },
    {
      product_name: "Analytics Dashboard",
      launch_date: "2025-04-01",
      outcome: "below_targets",
      metrics: { signups_day1: 120, conversion_rate: 4, nps: 28, revenue_month1: 22000 },
      lessons_learned: "Launched without proper competitive positioning. Sales team wasn't trained. No beta program meant we missed critical UX issues.",
      what_worked: ["Blog content drove organic traffic", "Product Hunt launch got attention"],
      what_didnt: ["No sales enablement", "Pricing was confusing", "No beta validation", "Launched on a Friday"],
    },
  ],

  pricing_models: [
    {
      model_id: "standard-saas-3tier",
      tier_name: "Starter",
      price_point: 49,
      billing: "monthly",
      features_included: ["5 team members", "Basic analytics", "Email support", "1 integration"],
      target_segment: "SMB / Individual teams",
      conversion_rate: 8,
    },
    {
      model_id: "standard-saas-3tier",
      tier_name: "Pro",
      price_point: 149,
      billing: "monthly",
      features_included: ["25 team members", "Advanced analytics", "Priority support", "Unlimited integrations", "Custom workflows"],
      target_segment: "Growing teams / Mid-market",
      conversion_rate: 5,
    },
    {
      model_id: "standard-saas-3tier",
      tier_name: "Enterprise",
      price_point: 499,
      billing: "monthly",
      features_included: ["Unlimited members", "Enterprise analytics", "Dedicated CSM", "SSO/SAML", "Custom SLA", "On-premise option"],
      target_segment: "Enterprise / Regulated industries",
      conversion_rate: 2,
    },
  ],

  sales_playbooks: [
    {
      title: "Enterprise Discovery Playbook",
      segment: "Enterprise",
      persona: "VP of Product",
      talkTrack: "I noticed your team recently launched [product]. How did that go? ... Most teams we talk to find that the coordination across engineering, marketing, and sales is where things break down. Is that something you've experienced?",
      discoveryQuestions: [
        "How many product launches do you run per year?",
        "What's your current process for coordinating cross-functional teams?",
        "Where do launches typically get delayed?",
        "How do you measure launch success?",
        "What tools are you using today for launch management?",
      ],
      objections: [
        { objection: "We already have project management tools", response: "Project management tracks tasks. We orchestrate the entire launch lifecycle — from market research through post-launch optimization. It's the difference between a to-do list and an operating system." },
        { objection: "Our team is too small for this", response: "That's actually where we shine most. Smaller teams can't afford to have launches slip. Our AI agents handle the work of 3-4 additional team members." },
      ],
    },
  ],
};
