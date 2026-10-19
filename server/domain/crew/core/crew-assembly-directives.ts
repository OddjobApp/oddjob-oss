import type { CrewOutputIntent } from "@shared/crew-output-intent.js";


/**
 * Phrases that name Computer Use Studio outright. Phrases rather than the bare
 * word "browser", which appears in ordinary discussion ("works in my browser").
 */
const COMPUTER_STUDIO_PHRASES = [
    "computer use", "computer studio", "trycua", "headless browser", "browser automation",
    "automate the browser", "automate a browser", "automate my browser",
];

/**
 * Phrases that name Project Studio. "project plan" and "roadmap" are not here:
 * they draft a new plan in ProjectPlanningPod, whereas the studio is where a
 * plan is opened and edited.
 */
const PROJECT_STUDIO_PHRASES = ["project studio", "project timeline", "project tracker"];

/**
 * Message keywords that mean the user wants something built rather than
 * discussed. A message matching none of these is not an assembly request and
 * gets no directive at all.
 */
const ASSEMBLY_PRIMITIVE_KEYWORDS = [
        "build", "assemble", "scaffold", "creation studio", "creation surface",
        "builder pod", "scaffoldpackpod", "pipelinebuilderpod",
        "agentichrpod", "hilgovernancepod", "missionbriefpod", "datasetschemapod", "mount",
        "workflow diagram", "mermaid", "diagram", "xray", "x-ray", "blueprint diagram",
        "operational cycle", "cycle", "new cycle", "create cycle",
        "create a new cycle", "workstream", "pipeline",
        "agent fleet", "agent roster", "persona", "dataset", "governance policy",
        "hil gate", "mission brief", "campaign", "new mission", "create mission",
        "mission creation surface",
        // Document and presentation deck deliverables
        "deck", "presentation", "slides", "slide deck", "generate the deck", "generate a deck",
        "status brief", "daily brief", "whitepaper", "executive brief", "deliverable",
        "generate pdf", "generate excel", "generate word",
        // Spatial analytics, Geographic Maps & Real Estate Distress
        // Bare "map"/"maps" are NOT gate keywords: the gate matches substrings, so
        // they opened it for "sitemap", "bitmap" and "map out our options", which
        // no rule claims and which then got a ScaffoldPackPod directive. Map
        // words open the gate only when the geographic map rule claims the
        // message -- see detectAssemblyIntent.
        "geographic map", "interactive map", "display map", "show map", "render map", "pin map", "store locator", "map in crew", "map in chat", "maps in crew", "maps in chat",
        "h3", "hexagon", "hex map", "spatial map", "signal intelligence",
        "geofence", "heatmap", "telemetry map", "uber h3", "spatial analytics",
        "distress", "distressed", "foreclosure", "pre-foreclosure", "real estate", "realestate",
        // Signal Studio & Industry Starter Packs
        "signal studio", "starter pack", "starter packs", "industry pack", "industry packs",
        "signal pack", "signal packs", "harvesting pack", "harvesting packs", "pre-configured signals", "preconfigured signals",
        // Signal Response Playbooks & Mitigation Initiatives
        "response playbook", "recommended playbook", "mitigation initiative", "exposure footprint", "market signal",
        "operational exposure", "incident playbook", "response initiative",
        // Forms, Calculators & Location Inputs
        "calculator", "intake form", "tip calculator", "mortgage calculator", "bill split",
        "location picker", "location selection", "add location", "location to",
        // On-the-fly and Instant Apps
        "on the fly", "on-the-fly", "instant app", "instant preview", "instant surface",
        "weather app", "forecast app", "live app", "live data app", "live weather", "weather widget", "weather tracker",
        "crypto app", "currency converter", "stock ticker", "score tracker", "flight tracker",
        // Planning, decisions, upskilling and tool synthesis.
        //
        // "I want to plan a project" matched nothing here, so the gate returned
        // "" and no builder pod was ever offered. Phrases rather than the bare
        // words "plan"/"project", which appear in ordinary discussion of work
        // that is not a request to open a surface.
        "plan a project", "plan the project", "project plan", "project planning",
        "planning pod", "roadmap", "cpm wave", "wave plan", "critical path",
        "project studio", "open project studio", "builder studio",
        "decision matrix", "trade-off", "tradeoff", "weigh the options",
        "upskill", "agent training", "train the agent", "competency",
        "tool forge", "scaffold a tool", "new tool", "api connector", "rest connector",
        // Flows. Phrases rather than the bare word "flow", which appears in
        // ordinary discussion ("the data flow is confusing") that is not a
        // request to build anything -- a message that passes this gate and
        // matches no rule gets a builder pod directive it did not ask for.
        // "pipeline" and "workstream" are already above.
        "build a flow", "create a flow", "make a flow", "assemble a flow",
        "set up a flow", "wire up a flow", "draft a flow", "design a flow",
        "new flow", "process flow", "automation", "automate",
        // Studios with their own mount tool. Spread from the phrase lists their
        // rules match, so every phrase that opens the gate is one a rule claims.
        ...COMPUTER_STUDIO_PHRASES,
        ...PROJECT_STUDIO_PHRASES,
    ];

/**
 * Assembly directives in priority order: the first rule whose predicate matches
 * wins, and nothing after it is consulted.
 *
 * This was a cascade of if-return blocks, which made precedence a property of
 * where a block happened to sit in a 180-line method. As a table the precedence
 * is the array index, and adding a surface is a new entry rather than an edit to
 * control flow.
 *
 * Ordering that carries meaning and must not be shuffled:
 *   - the Form Studio rule leads, because "build a calculator that saves to a
 *     dataset" also names a dataset, and falling through would mount a dataset pod.
 *   - the Computer Use and Project Studio rules precede Flow Studio, which
 *     would otherwise claim "automate" and "automation" requests that name a
 *     browser or a project timeline.
 *   - the deck rule outranks file generation, so "generate the deck as a pdf"
 *     produces a deck rather than a bare pdf.
 */
const ASSEMBLY_DIRECTIVES: Array<{ id: string; match: (lower: string) => boolean; directive: string }> = [
    {
        id: "on_the_fly_app",
        /*
         * On-the-fly dynamic apps, instant tools, calculators, and live data widgets
         * built and rendered directly in the conversation without opening side-rail studios
         * or scaffolding full App Forge projects.
         */
        match: (lower) => {
            const hasOnTheFlyPhrase =
                lower.includes("on the fly") ||
                lower.includes("on-the-fly") ||
                lower.includes("instant app") ||
                lower.includes("instant preview") ||
                (lower.includes("mock") && (lower.includes("app") || lower.includes("weather") || lower.includes("dashboard"))) ||
                /\b(?:weather\s+app|forecast\s+app|live\s+data\s+app|live\s+tracker|live\s+app)\b/.test(lower);
            if (hasOnTheFlyPhrase) return true;

            /*
             * A computation widget asked to be SHOWN is an instant app, not a
             * Form Studio lookup: "show me a mortgage calculator" used to land
             * in the form registry and come back "no such form exists" while
             * nothing rendered. Form Studio keeps the build-, save- and
             * edit-bound requests below — those create a persistent form, and
             * "add a field to the tip calculator" edits an existing one.
             */
            const namesComputation =
                /\b(?:calculators?|converters?|conversions?|estimators?|amorti[sz]ation)\b/.test(lower);
            if (!namesComputation) return false;
            const formStudioBound =
                lower.includes("dataset") ||
                lower.includes("pipeline") ||
                lower.includes("database") ||
                lower.includes("submission") ||
                lower.includes("form studio") ||
                /\b(?:saves?|saved|saving|records?|stores?|logs?|add|changes?|updates?|edits?|modify|deletes?|removes?|builds?|creates?|makes?|designs?|develops?|drafts?|authors?)\b/.test(lower);
            if (formStudioBound) return false;
            const displayVerb =
                /\b(?:shows?|render|displays?|give|opens?|mount|try|see|view|needs?|wants?)\b/.test(lower);
            const bareRequest =
                lower.split(/\s+/).filter(Boolean).length <= 6 &&
                !/^\s*(?:which|what|how|why|when|where|who)\b/.test(lower);
            return displayVerb || bareRequest;
        },
        directive:
            `\n\n` +
            `⚡ ON-THE-FLY APP BUILDING DIRECTIVE: The user is asking to build or render an app ON THE FLY (e.g. weather app, live data app, dynamic calculator, or instant dashboard). ` +
            `You have full platform capability to build and render it immediately in the conversation — DO NOT claim that no app exists in the catalog, DO NOT propose App Forge or ask to start a multi-day project, and DO NOT open side-rail studios: ` +
            `1) For LIVE DATA or INTERACTIVE APPS (e.g. weather, currency, stocks, calculators, trackers): ` +
            `   Call render_intake_form immediately with: ` +
            `   - Input fields: 'location' (with interactive map and GPS button), 'text', or 'number'; ` +
            `   - 'query' fields that connect to live external APIs via Oddjob's secure HTTP connector (e.g. url: 'https://api.open-meteo.com/v1/forecast', params: { latitude: '{{latitude}}', longitude: '{{longitude}}', current_weather: 'true' }, jsonPath: 'current_weather.temperature', unit: '°C'); ` +
            `   - 'computed' fields that evaluate live formulas over other field values (e.g. formula: 'round(temp * 9/5 + 32, 1)'). ` +
            `2) For COMPOSABLE DASHBOARDS, MAPS or MOCK DATA PREVIEWS: ` +
            `   Call assemble_instant_app with packaged UI blocks passing structured props: ` +
            `   - For maps and geographic views, use block "MapPod" with props { markers: [{ lat, lng, label, description }], center, zoom, title } or call render_instant_app({ component: "MapPod", props: { ... } }); ` +
            `   - For metrics and overviews, use MetricGrid, IndustrialDashboardHero, StatusTimeline. ` +
            `DO NOT answer in text without calling render_intake_form or assemble_instant_app!`,
    },
    {
        id: "form_studio",
        /*
         * Calculators, intake forms and form data capture are built in Form Studio.
         * This replaced two rules: an end-to-end wiring rule that mounted
         * FullStackAssemblyPod, and an intake rule that rendered a throwaway
         * render_intake_form card. A request that persists or runs something but
         * names no form is left to the rules below.
         */
        match: (lower) => {
            const namesForm = /\b(?:calculator|form|intake|questionnaire|survey|assessment|scorecard|checklist)s?\b/.test(lower);
            const hasDatasetOrPipelineGoal =
                lower.includes("dataset") ||
                lower.includes("pipeline") ||
                lower.includes("database") ||
                lower.includes("save the calculation") ||
                lower.includes("save calculation") ||
                lower.includes("save to") ||
                lower.includes("save data") ||
                lower.includes("full stack") ||
                lower.includes("self assembly") ||
                lower.includes("link app") ||
                lower.includes("link an app");

            const hasBuilderOrCalcGoal =
                lower.includes("build") ||
                lower.includes("create") ||
                lower.includes("assemble") ||
                lower.includes("calculator") ||
                lower.includes("form") ||
                lower.includes("app") ||
                lower.includes("parameter") ||
                lower.includes("save") ||
                lower.includes("link") ||
                lower.includes("connect") ||
                lower.includes("wire");

            const isIntakeRequest =
                lower.includes("calculator") ||
                lower.includes("intake form") ||
                lower.includes("bill split") ||
                lower.includes("location picker") ||
                lower.includes("location selection") ||
                (lower.includes("location") && (lower.includes("form") || lower.includes("tip") || lower.includes("input") || lower.includes("add")));

            return isIntakeRequest || (namesForm && hasDatasetOrPipelineGoal && hasBuilderOrCalcGoal);
        },
        directive:
            `\n\n` +
            `⚡ FORM STUDIO DIRECTIVE: The user is asking about a calculator, intake form, questionnaire or other form, possibly one that records to a dataset or feeds a pipeline. Forms are built in Form Studio. ` +
            `To open an existing form, call mount_form_studio with its name. Use available Form Studio tools for explicitly requested draft edits; read the current revision before saving. Use proposal cards for suggested changes that the user has not requested. Only describe a form as created or changed after the write succeeds. ` +
            `DO NOT call render_intake_form or mount_builder_pod for these requests. ` +
            `Form submissions can write to a configured dataset and request pipeline actions through the submission runtime and approval workflow. Inspect the saved bindings and actual submission/action results before claiming a dataset was updated or a pipeline ran.`,
    },
    {
        id: "computer_studio",
        /*
         * Operating a browser or desktop is Computer Use Studio's. With no rule,
         * "automate the browser" passed the gate on "automate", missed the flow
         * rule (which wants "automation" or "flow") and fell through to the
         * ScaffoldPackPod default.
         *
         * Besides the named phrases, a browser or website surface together with
         * an operating verb claims the message. "automate" is a verb here but
         * "automation" is not, so "build an automation that updates the website"
         * still reaches Flow Studio below. Building a site is not operating one:
         * "build a website where users fill out a form" is left to the rules below.
         */
        match: (lower) => {
            if (COMPUTER_STUDIO_PHRASES.some((p) => lower.includes(p))) return true;
            const namesSurface = /\b(?:web\s?browsers?|browsers?|websites?|web\s?pages?|web\s?portals?)\b/.test(lower);
            const operates = /\b(?:automate|automatically|click|navigate|fill\s+(?:in|out)|scrape)\b/.test(lower);
            const buildsSite = /\b(?:build|create|make|design|develop)\s+(?:(?:a|an|the|our|my)\s+)?(?:new\s+)?(?:web\s?sites?|web\s?pages?|web\s?portals?|sites?|pages?|portals?)\b/.test(lower);
            return namesSurface && operates && !buildsSite;
        },
        directive:
            `\n\n` +
            `⚡ COMPUTER USE STUDIO DIRECTIVE: The user wants a browser or desktop operated for them. ` +
            `Call mount_computer_studio({ goal: "<the task, in the user's words>" }) to open Computer Use Studio in the side-rail with the task filled in. ` +
            `The studio does not start on its own: the person reviews the goal and starts the run, and can watch or take over the screen. ` +
            `Never describe a page as visited, a form as filled or data as extracted unless a tool result shows it happened. ` +
            `DO NOT call mount_builder_pod or propose_flow for these requests.`,
    },
    {
        id: "signal_response_playbook",
        /*
         * Triage, exposure footprint analysis, or response playbook dispatches
         * from Signal Studio or chat. Sits ahead of Project Studio so "Initiate
         * response playbook for signal X. Spin up mitigation initiative in Project
         * Studio" mounts Signal Studio and evaluates the signal rather than opening
         * a blank project timeline.
         */
        match: (lower) => {
            const hasPlaybookOrMitigation =
                lower.includes("response playbook") ||
                lower.includes("recommended playbook") ||
                lower.includes("mitigation initiative") ||
                lower.includes("response initiative") ||
                lower.includes("initiate response") ||
                (lower.includes("playbook") && (lower.includes("signal") || lower.includes("exposure") || lower.includes("incident")));
            const hasSignalContext =
                lower.includes("signal") ||
                lower.includes("exposure footprint") ||
                lower.includes("operational exposure") ||
                lower.includes("affected enterprise") ||
                lower.includes("blast radius");
            return hasPlaybookOrMitigation && hasSignalContext;
        },
        directive:
            `\n\n` +
            `⚡ SIGNAL RESPONSE PLAYBOOK DIRECTIVE: The user is initiating a response playbook, evaluating an operational exposure footprint, or spinning up a mitigation initiative for a market signal. ` +
            `You MUST call mount_signal_studio({ view: "overview", title: "Signal Response & Exposure Triage" }) ` +
            `immediately to mount Signal Studio in the side-rail so the user can inspect the live signal, sensor telemetry, and corridor footprint. ` +
            `1) Identify the signal severity, jurisdiction, and affected industry vertical (Supply Chain, Cyber/Cloud, Regulatory, Macro, Severe Weather, Corporate Filings, or Real Estate). ` +
            `2) Synthesize the operational exposure footprint and blast radius. ` +
            `3) Propose or dispatch the concrete domain mitigation playbook: ` +
            `   - If the user asked to spin up a mitigation project in Project Studio, call mount_project_studio with a structured wave plan or draft project deliverables. ` +
            `   - If spatial H3 coordinates are present, explain the geospatial exposure. ` +
            `   - Present clear next actions and governance checkpoints (HIL sign-off) before modifying production assets. ` +
            `DO NOT discuss or analyze the signal in open-ended prose without calling mount_signal_studio.`,
    },
    {
        id: "project_studio",
        /*
         * Opening Project Studio went to mount_builder_pod("ProjectStudioPod"),
         * which renders the same pod empty. mount_project_studio can reopen a
         * saved cycle's wave plan by cycleId and never shows example data.
         *
         * Sits ahead of Flow Studio so "create a project timeline for the
         * automation rollout" opens the studio rather than drafting a flow.
         */
        match: (lower) => PROJECT_STUDIO_PHRASES.some((p) => lower.includes(p)),
        directive:
            `\n\n` +
            `⚡ PROJECT STUDIO DIRECTIVE: The user is asking to open Project Studio or see a project's timeline. ` +
            `Call mount_project_studio to open it in the side-rail. To reopen a saved cycle's wave plan, pass its cycleId -- only an id the conversation or a tool result gave you, never a guessed one. ` +
            `To open a new plan for editing, pass projectTitle, objective and waves. With neither, the studio opens empty. ` +
            `DO NOT call mount_builder_pod(podComponent: "ProjectStudioPod") for these requests.`,
    },
    {
        id: "flow_studio",
        /*
         * Building a flow is Flow Studio's, not a builder pod's.
         *
         * Without this rule a request to build a pipeline fell through to
         * BUILDER_POD_RULES and mounted PipelineBuilderPod, whose Save button
         * writes a blueprint stage and no pipeline -- so the user designed a flow
         * on screen and nothing was ever created. Worse, the fallthrough directive
         * says "DO NOT call propose_*", which suppressed propose_flow outright.
         *
         * A build verb is required, so "configure the pipeline trigger" still
         * reaches the pod: adjusting a stage inside an assembly session is a
         * different request from asking for a flow that runs.
         *
         * Sits after the Form Studio rule, which must keep leading -- "build a
         * calculator that saves to a pipeline" is a form, not a flow.
         */
        match: (lower) => {
            const namesFlow = /\b(?:flows?|pipelines?|workstreams?|automations?)\b/.test(lower);
            const buildVerb = /\b(?:build|create|make|assemble|automate|set\s+up|wire\s+up|draft|design)\b/.test(lower);
            // Property discovery has its own connected-feed surface. Generic
            // job pipelines cannot substitute for that domain-specific intake.
            return namesFlow && buildVerb && !isResidentialDistressRequest(lower);
        },
        directive:
            `

` +
            `⚡ FLOW STUDIO DIRECTIVE: The user is asking for a flow -- an ordered sequence of this ` +
            `organization's existing jobs that runs as a pipeline. ` +
            `Call list_jobs FIRST to see what jobs exist, then call propose_flow with steps naming those jobs. ` +
            `To open an existing flow or inspect the flow in the side-rail, call mount_flow_studio. ` +
            `DO NOT call mount_builder_pod(podComponent: "PipelineBuilderPod"): that surface designs a stage and ` +
            `saves no pipeline. DO NOT invent job names -- every step must be a job list_jobs returned. ` +
            `propose_flow writes nothing; it returns a card, and a person presses Create.`,
    },
    {
        id: "prediction_studio",
        match: (lower) => {
            const namesPred = /\b(?:predictions?|infer|surrogates?|forecasts?|rerank|probability|confidence\s+envelope)\b/.test(lower);
            const actionVerb = /\b(?:mount|open|show|inspect|test|run|evaluate|predict|forecast|train|bind)\b/.test(lower);
            return namesPred && (actionVerb || lower.includes("prediction studio"));
        },
        directive:
            `\n\n` +
            `⚡ PREDICTION STUDIO DIRECTIVE: The user is asking about predictions, inference, surrogate models, or forecasting. ` +
            `Call mount_prediction_studio to inspect real-time inference, confidence envelopes (p10/p50/p90), and drift metrics in the side-rail. ` +
            `To estimate a trajectory from a feature vector, call estimate_trajectory. It is kinematics, not a model — say so when reporting it.`,
    },
    {
        id: "presentation_deck",
        match: (lower) =>
            lower.includes("deck") || lower.includes("presentation") || lower.includes("slides") || lower.includes("slide deck") || lower.includes("whitepaper") || lower.includes("status brief") || lower.includes("daily brief"),
        directive:
            `\n\n` +
            `⚡ PRESENTATION DECK & DELIVERABLE DIRECTIVE: The user is asking to create, compile, or generate a presentation deck, slide deck, daily brief, or visual deliverable. ` +
            `You MUST call generate_presentation_deck({ title: "<meaningful title>", content: "<synthesized sections, KPIs, and bullet points based on the discussion>", themeId: "dark_cyberpunk" | "glass_corporate", formatCategory: "presentation_deck" }) immediately. ` +
            `DO NOT mount input forms, DO NOT ask open-ended questions about what details are needed when the user or transcript has already provided sections or intent, and DO NOT debate in prose. Call generate_presentation_deck directly to assemble and render the multi-slide AST deliverable.`,
    },
    {
        id: "file_generation",
        match: (lower) =>
            lower.includes("generate pdf") || lower.includes("export pdf") || lower.includes("generate word") || lower.includes("generate excel") || lower.includes("generate spreadsheet"),
        directive:
            `\n\n` +
            `⚡ FILE GENERATION DIRECTIVE: The user is asking to generate a document or spreadsheet deliverable. ` +
            `Call generate_pdf, generate_word, or generate_excel immediately with the synthesized content.`,
    },
    {
        id: "workflow_diagram",
        match: (lower) =>
            lower.includes("mermaid") || lower.includes("diagram") || lower.includes("xray") || lower.includes("x-ray") || lower.includes("dependency flow"),
        directive:
            `\n\n` +
            `⚡ WORKFLOW DIAGRAM & X-RAY DIRECTIVE: The user is asking to view a Mermaid / X-Ray workflow diagram or dependency graph of a blueprint or cycle. ` +
            `You MUST call render_workflow_diagram(stages: [...]) AND/OR call render_app_surface({ title: "Component Dependency Flow & X-Ray Canvas", href: "/platform-maintenance/documentation?tab=xray&appId=chaos-drill", mode: "embed" }) ` +
            `to generate and mount the interactive visual X-Ray surface immediately into the chat turn. ` +
            `Do not claim to have rendered it without calling render_workflow_diagram or render_app_surface.`,
    },
    {
        id: "signal_studio_starter_packs",
        match: (lower) => {
            const hasPackKeyword =
                lower.includes("starter pack") ||
                lower.includes("starter packs") ||
                lower.includes("industry pack") ||
                lower.includes("industry packs") ||
                lower.includes("signal pack") ||
                lower.includes("signal packs") ||
                lower.includes("harvesting pack") ||
                lower.includes("harvesting packs") ||
                lower.includes("pre-configured signals") ||
                lower.includes("preconfigured signals");
            return hasPackKeyword || (lower.includes("signal studio") && (lower.includes("pack") || lower.includes("starter") || lower.includes("template")));
        },
        directive:
            `\n\n` +
            `⚡ SIGNAL STUDIO INDUSTRY STARTER PACKS DIRECTIVE: The user is asking about, requesting, or training on Industry Starter Packs in Signal Studio. ` +
            `You MUST call mount_signal_studio({ view: "packs", title: "Signal Studio Industry Starter Packs" }) ` +
            `immediately to mount the interactive Industry Starter Packs catalog in the side-rail beside the conversation. ` +
            `Signal Studio includes 7 pre-engineered Industry Starter Packs that provide 1-click feed activation, automated JSONPath extraction, H3 spatial radar mapping, and downstream CREW deliberation playbooks: ` +
            `1) Residential Real Estate Distress & Acquisition (NOD, trustee auctions, tax liens, substandard housing citations, loan tape underwriting; default playbook: Launch Residential Distress Assembly in CREW with HIL offer sign-off); ` +
            `2) Global Supply Chain & Logistics (maritime AIS corridors, tier-1 port congestion, carrier blank sailings, freight rates; default playbook: Recalculate delivery milestones and initiate supplier rerouting RFP); ` +
            `3) Regulatory, Sanctions & Trade Policy (SEC EDGAR 8-K/10-K, USTR Section 301 tariffs, EU AI Act / CSRD directives; default playbook: Screen master vendor list against new OFAC entries and file RFC); ` +
            `4) Macroeconomic & Central Banking (Federal Reserve FOMC bulletins, discount window rates, financial pulse; default playbook: Update cost-of-capital forecast and trigger FX exposure assessment); ` +
            `5) Critical Cloud & Cybersecurity Resilience (CISA Known Exploited Vulnerabilities, automated multi-cloud & API status health streams; default playbook: Trigger automated multi-region failover and notify customer success); ` +
            `6) Severe Weather & Energy Grid Resilience (NWS severe hazards, hurricane tracks, regional power grid stress; default playbook: Trigger facility contingency checklist and shift critical workloads); ` +
            `7) Corporate Filings & Competitor Watchlist (TechCrunch venture shifts, competitor M&A/restructuring, Reddit grassroots operator sentiment; default playbook: Draft competitive counter-brief in Scribe Studio). ` +
            `When assisting the user: explain the 7 available packs, guide them through activating feeds and reviewing JSONPath mapping schemas, and offer to trigger the associated CREW autonomous cycle or HIL approval workflow. ` +
            `DO NOT discuss or enumerate starter packs in prose without calling mount_signal_studio({ view: "packs", title: "Signal Studio Industry Starter Packs" }).`,
    },
    {
        id: "residential_distress",
        match: isResidentialDistressRequest,
        directive:
            `\n\n` +
            `⚡ RESIDENTIAL REAL ESTATE DISTRESS ASSEMBLY DIRECTIVE: The user is asking to build or mount the Residential Real Estate Distress Assembly in CREW. ` +
            // Signal Studio has its own mount tool (a115f4a08); mount_builder_pod
            // rejects SignalStudioPod, so pointing the model there made it fail.
            `You MUST call mount_signal_studio({ view: "spatial", title: "Residential Real Estate Distress Assembly" }) ` +
            `immediately to mount the spatial map into the CREW room. ` +
            `For property discovery, focus on jurisdiction, connected sources, distress filters, and reviewing matching properties with source evidence. ` +
            `Do not expand a research request into underwriting, dossier exports, or offers unless the human requests those capabilities. ` +
            `Describe additional stages as proposals, never as working integrations without successful tool evidence. ` +
            `Say plainly that the map only shows what connected feeds provide — no county records are bundled — and never state an address, filing or balance you did not read from a tool result. ` +
            `Do not mount ScaffoldPackPod or call scaffold_multistep_app for property discovery: software host, auth and database packs do not configure property feeds. ` +
            `Ask for the target jurisdiction and data source when missing. Opening the map is not building or activating a working flow. ` +
            `DO NOT discuss in prose without mounting the surface.`,
    },
    {
        id: "spatial_map",
        match: (lower) =>
            lower.includes("h3") || lower.includes("hexagon") || lower.includes("hex map") || lower.includes("spatial map") || lower.includes("geofence") || lower.includes("signal intelligence") || lower.includes("uber h3") || lower.includes("telemetry map") || lower.includes("heatmap") || lower.includes("spatial analytics"),
        directive:
            `\n\n` +
            `⚡ SPATIAL MAP DIRECTIVE: The user is asking for an H3 hexagonal spatial map, geofence visualization, or Signal Intelligence telemetry heatmap. ` +
            `Call render_app_surface({ title: "Signal Intelligence & Uber H3 Hexagonal Spatial Map", href: "/signal-intelligence", mode: "embed" }) ` +
            `to open the interactive Signal Intelligence workbench with Uber H3 hexagonal overlays, geofence zones, and real-time asset tracking. ` +
            `You may also call h3_hexagonal_spatial_evaluate or geofence_spatial_evaluate to compute spatial state for a specific asset and include the results inline.`,
    },
    {
        id: "geographic_map",
        match: (lower) => {
            const hasMapKeyword = /\b(?:maps?|mapping|geographical?|locations?|coordinates?|waypoints?|pinpoints?|routes?|routing|directions?|destination|origin)\b/.test(lower);
            const actionVerb = /\b(?:show|display|render|view|plot|visualize|pin|locate|find|draw|see|generate|create|want|work|working)\b/.test(lower);
            const explicitMapPhrase =
                lower.includes("interactive map") ||
                lower.includes("crew map") ||
                lower.includes("map in chat") ||
                lower.includes("maps in chat") ||
                lower.includes("map in crew") ||
                lower.includes("maps in crew") ||
                lower.includes("map surface") ||
                lower.includes("route mapping") ||
                lower.includes("route map") ||
                lower.includes("store locator") ||
                lower.includes("render_map");
            return explicitMapPhrase || (hasMapKeyword && (actionVerb || lower.includes("in crew") || lower.includes("in chat") || lower.includes("not working") || lower.includes("displayed")));
        },
        directive:
            `\n\n` +
            `⚡ GEOGRAPHIC MAP VISUALIZATION DIRECTIVE: The user wants an interactive map or route displayed in CREW chat. ` +
            `You can render it directly using render_map({ markers: [{ lat, lng, label, description, color }], center, zoom, title, route: { waypoints: [{ lat, lng, label, description }], profile: "driving" } }) ` +
            `OR using an instant app via assemble_instant_app({ blocks: [{ component: "MapPod", props: { markers, center, zoom, title, route: { waypoints: [...] } } }] }) (or render_instant_app({ component: "MapPod", props: { markers, center, zoom, title, route: { waypoints: [...] } } })). ` +
            `FOR ROUTE MAPPING / DIRECTIONS: ALWAYS include 'route' with ordered waypoints from origin to destination (e.g. route: { waypoints: [{ lat, lng, label: "Origin: ..." }, { lat, lng, label: "Destination: ..." }], profile: "driving" }) and include both origin and destination in 'markers'. The platform automatically road-snaps the route via Mapbox Directions and displays the route line with distance/duration and origin/destination pins. ` +
            `If specific locations or addresses need coordinates, call geocoding or geo_discovery first to resolve coordinates, then immediately call render_map or render_instant_app with the route and markers. ` +
            `If the user explicitly asks for an instant app, use assemble_instant_app or render_instant_app with MapPod. ` +
            `If no specific locations are mentioned or known, call render_map({ title: "Live Map", description: "Interactive map surface with live GPS positioning", markers: [] }) or render_instant_app({ component: "MapPod", props: { title: "Live Map", markers: [] } }) which will automatically display the map and request user location permission to pinpoint their position. ` +
            `DO NOT reply in plain text without invoking render_map or assemble_instant_app!`,
    },
];

/**
 * Which creation surface a primitive request mounts when no more specific
 * directive claimed it. First match wins, so the order is the precedence.
 */
const BUILDER_POD_RULES: Array<{ pod: string; match: (lower: string) => boolean }> = [
    // The four pods added alongside the hybrid orchestration work had no rule at
    // all, so nothing could route to them even once the gate above let a message
    // through — "I want to plan a project" fell to the ScaffoldPackPod default.
    //
    // They lead because their matchers are phrase-specific and cannot steal from
    // the rules below: none of "decision matrix", "plan a project" or "tool
    // forge" contains mission/campaign/cycle/pipeline/governance/dataset. The one
    // deliberate precedence change is AgentUpskillingPod ahead of AgenticHRPod:
    // "upskill the agent" contains "agent", and upskilling is the more specific
    // reading.
    { pod: "ProjectStudioPod", match: (l) => l.includes("project studio") || l.includes("open project studio") || l.includes("builder studio") },
    { pod: "ProjectPlanningPod", match: (l) => l.includes("plan a project") || l.includes("plan the project") || l.includes("project plan") || l.includes("project planning") || l.includes("planning pod") || l.includes("roadmap") || l.includes("cpm wave") || l.includes("wave plan") || l.includes("critical path") },
    { pod: "DecisionMatrixPod", match: (l) => l.includes("decision matrix") || l.includes("trade-off") || l.includes("tradeoff") || l.includes("weigh the options") },
    { pod: "AgentUpskillingPod", match: (l) => l.includes("upskill") || l.includes("agent training") || l.includes("train the agent") || l.includes("competency") },
    { pod: "ToolScaffoldPod", match: (l) => l.includes("tool forge") || l.includes("scaffold a tool") || l.includes("new tool") || l.includes("api connector") || l.includes("rest connector") },
    { pod: "MissionBriefPod", match: (l) => l.includes("mission") || l.includes("campaign") || l.includes("research") || l.includes("creation surface") },
    { pod: "ScaffoldPackPod", match: (l) => l.includes("cycle") || l.includes("operational cycle") },
    { pod: "AgenticHRPod", match: (l) => l.includes("agent") || l.includes("roster") || l.includes("persona") },
    { pod: "PipelineBuilderPod", match: (l) => l.includes("pipeline") || l.includes("workstream") || l.includes("trigger") },
    { pod: "HILGovernancePod", match: (l) => l.includes("governance") || l.includes("hil") || l.includes("approval") || l.includes("attestation") },
    { pod: "DatasetSchemaPod", match: (l) => l.includes("dataset") || l.includes("schema") || l.includes("table") || l.includes("vector") },
];

/**
 * The directive to append when the user is asking for something to be built.
 *
 * Two stages: a keyword gate that decides whether this is an assembly request
 * at all, then the first matching rule in ASSEMBLY_DIRECTIVES. A request that
 * passes the gate but matches no specific rule falls through to a builder pod
 * chosen by BUILDER_POD_RULES.
 *
 * This is the highest-signal injection point: it sits in the user turn
 * instruction, immediately before generation, overriding any tendency to
 * mis-route the intent through list_installed_apps or converse in open-ended
 * prose.
 */
export function isResidentialDistressRequest(message: string): boolean {
    const lower = message.toLowerCase();
    return /\b(?:distress(?:ed)?|(?:pre-)?foreclosure)\b/.test(lower) &&
        /\b(?:residential|real\s?estate|propert(?:y|ies)|assembly|build|pipeline|radar)\b/.test(lower);
}

export function detectAssemblyIntent(userMessage: string): string {
    const lower = userMessage.toLowerCase();
    const opensGate =
        ASSEMBLY_PRIMITIVE_KEYWORDS.some((kw) => lower.includes(kw)) ||
        ASSEMBLY_DIRECTIVES.some((rule) => rule.id === "geographic_map" && rule.match(lower));
    if (!opensGate) return "";

    for (const rule of ASSEMBLY_DIRECTIVES) {
        if (rule.match(lower)) return rule.directive;
    }

    const suggestedPod = BUILDER_POD_RULES.find((r) => r.match(lower))?.pod ?? "ScaffoldPackPod";
    return (
        `

` +
        `⚡ PRIMITIVE MODULE SURFACE DIRECTIVE: The user is asking about creating/configuring a platform primitive (${suggestedPod}). ` +
        `DO NOT call propose_cycle_draft or propose_mission yet, DO NOT ask open-ended questions in prose, and DO NOT call list_installed_apps. ` +
        `Instead, call mount_builder_pod(podComponent: "${suggestedPod}") FIRST to mount the interactive creation surface ` +
        `inline in the chat for the user to fill in details. ` +
        // Must stay in step with mount_builder_pod's own enum in assembly-tools.ts.
        // This list had drifted behind it by four pods, so the directive — the
        // highest-signal steer, injected immediately before generation — told the
        // model a shorter list than the tool actually accepts.
        `Available podComponent values: "MissionBriefPod", "ScaffoldPackPod", "AgenticHRPod", "PipelineBuilderPod", "HILGovernancePod", "DatasetSchemaPod", "DocumentDeckPod", "OntologyLinkTypePod", "ProjectPlanningPod", "ProjectStudioPod", "DecisionMatrixPod", "AgentUpskillingPod", "ToolScaffoldPod".`
    );
}

/**
 * Resolves the directive to inject based on an explicit outputIntent if provided.
 * If intent is omitted or "auto", delegates to heuristic `detectAssemblyIntent(message)`.
 * If intent is "deliberate", deliberately returns empty string to prevent builder pod injection.
 */
export function resolveDirectiveForOutputIntent(
    outputIntent: CrewOutputIntent | undefined | null,
    userMessage: string,
): string {
    if (!outputIntent || outputIntent === "auto") {
        return detectAssemblyIntent(userMessage);
    }

    switch (outputIntent) {
        case "deliberate":
            // Explicitly requested discussion/deliberation: suppress all builder directives.
            return "";

        case "present": {
            const rule = ASSEMBLY_DIRECTIVES.find((r) => r.id === "presentation_deck");
            return rule?.directive ?? "";
        }

        case "build_app": {
            const rule = ASSEMBLY_DIRECTIVES.find((r) => r.id === "on_the_fly_app");
            return rule?.directive ?? "";
        }

        case "map": {
            const rule = ASSEMBLY_DIRECTIVES.find((r) => r.id === "geographic_map");
            return rule?.directive ?? "";
        }

        case "diagram": {
            const rule = ASSEMBLY_DIRECTIVES.find((r) => r.id === "workflow_diagram");
            return rule?.directive ?? "";
        }

        case "author_document": {
            return (
                `\n\n` +
                `⚡ DIRECT ACTION: SCRIBE STUDIO AUTHORING: The user has requested to author or compose a structured document or PRD. ` +
                `Call mount_scribe_studio with an initial document title and outline to open Scribe Studio in the side-rail immediately. ` +
                `Do not discuss in open-ended prose without mounting Scribe Studio.`
            );
        }

        case "generate_image": {
            return (
                `\n\n` +
                `⚡ IMAGE GENERATION DIRECTIVE: The user has explicitly requested a generated image. ` +
                `Call generate_image now with a detailed prompt expanded from the request — specify subject, style, composition, lighting, and palette — ` +
                `a storage path under 'assets/' (for example 'assets/<slug>.png'), an optional aspectRatio, and a short title. ` +
                `The tool renders the image inline for the user: do not describe what the image would look like in prose instead of calling it, ` +
                `and do not mount a builder pod or studio for this request. If the call fails, report the actual error plainly.`
            );
        }

        case "audit_governance": {
            return (
                `\n\n` +
                `⚡ GOVERNANCE & HIL AUDIT DIRECTIVE: The user is requesting a governance audit and attestation review. ` +
                `Inspect compliance requirements, review active Human-In-The-Loop (HIL) gates, and call mount_builder_pod(podComponent: "HILGovernancePod") if configuring approvals, ` +
                `or request_governance_attestation to verify policy compliance before production execution.`
            );
        }

        default:
            return detectAssemblyIntent(userMessage);
    }
}
