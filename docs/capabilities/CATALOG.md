# Oddjob Capability Catalog

_Auto-generated from the live agent tool registry via the ACDD capability-manifest mapping (`toolDefinitionToManifest`). Regenerate with `npx tsx scripts/acdd-generate-catalog.ts`._

**625 capabilities** across **83 categories**. Each row is a capability contract — a discrete outcome the platform can perform — with its typed inputs (derived from the tool's schema). Categories reflect the tool's registered group. **Risk is a name/description heuristic**, a first-pass signal only (a per-tool risk profile is a follow-up). See `capabilities.md` for the capability model, lifecycle, and synchronization engine that keep these documents in sync with the code.

## Categories

- [Accounting](#accounting) — 16
- [Admin: Personality](#admin-personality) — 8
- [Agents](#agents) — 2
- [Airtable](#airtable) — 5
- [Amazon](#amazon) — 6
- [Analytics Databases](#analytics-databases) — 4
- [App Forge](#app-forge) — 27
- [Authoring](#authoring) — 12
- [CREW](#crew) — 3
- [Calculations](#calculations) — 1
- [Cloud](#cloud) — 3
- [Collaboration](#collaboration) — 5
- [Computer Use](#computer-use) — 19
- [Control Flow](#control-flow) — 1
- [Core Capabilities](#core-capabilities) — 7
- [Datasets & External](#datasets-external) — 9
- [Deliberation](#deliberation) — 4
- [Diagnostics](#diagnostics) — 1
- [Discovery](#discovery) — 5
- [Document Processing](#document-processing) — 2
- [Documentation](#documentation) — 4
- [Files & Storage](#files-storage) — 7
- [Finance](#finance) — 4
- [Flows](#flows) — 2
- [Formal Methods & Verification](#formal-methods-verification) — 4
- [Forms](#forms) — 6
- [GMS](#gms) — 7
- [Generation](#generation) — 10
- [Git Workspace](#git-workspace) — 13
- [GitHub](#github) — 7
- [Google Workspace](#google-workspace) — 45
- [Governance](#governance) — 3
- [HubSpot](#hubspot) — 6
- [Human Input](#human-input) — 2
- [Instant Apps](#instant-apps) — 3
- [Integrations](#integrations) — 20
- [Knowledge](#knowledge) — 8
- [Knowledge Graph](#knowledge-graph) — 13
- [Knowledge Graph Calculations](#knowledge-graph-calculations) — 3
- [Knowledge Management](#knowledge-management) — 10
- [Linear](#linear) — 5
- [Memory](#memory) — 1
- [Microsoft 365](#microsoft-365) — 11
- [Mission](#mission) — 3
- [Mission Control](#mission-control) — 4
- [Monitoring](#monitoring) — 6
- [Multimodal / Vision](#multimodal-vision) — 3
- [Notion](#notion) — 5
- [Observability](#observability) — 3
- [Ontology](#ontology) — 9
- [Operations](#operations) — 7
- [Pipeline Orchestration](#pipeline-orchestration) — 28
- [Platform & Specs](#platform-specs) — 10
- [Prediction](#prediction) — 3
- [Project Budget](#project-budget) — 2
- [Rescue](#rescue) — 4
- [Rich UI](#rich-ui) — 16
- [SDLC](#sdlc) — 18
- [SPATIAL](#spatial) — 7
- [Salesforce](#salesforce) — 5
- [Security](#security) — 6
- [Self-Modification](#self-modification) — 8
- [ServiceNow](#servicenow) — 6
- [Simulation](#simulation) — 1
- [Spatial](#spatial) — 1
- [SpatialOperations](#spatialoperations) — 1
- [Strategy](#strategy) — 3
- [Stripe](#stripe) — 5
- [Studio CRUD](#studio-crud) — 34
- [StudioCollaboration](#studiocollaboration) — 2
- [System Architecture](#system-architecture) — 2
- [System Management](#system-management) — 16
- [Travel](#travel) — 5
- [Tutorials & Onboarding](#tutorials-onboarding) — 1
- [Twilio / SMS](#twilio-sms) — 3
- [Ungrouped](#ungrouped) — 24
- [User Profile](#user-profile) — 3
- [User Understanding](#user-understanding) — 3
- [Video Content](#video-content) — 14
- [Web & Browser](#web-browser) — 3
- [Webhooks](#webhooks) — 3
- [YouTube](#youtube) — 10
- [Zendesk](#zendesk) — 4

## Accounting

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `calculate_dataset_prediction` | Analyze forecast dataset with prediction engine | `datasetId`: number<br>`limit`: number | Medium | Run existing Hidden State and Prediction Pods against an organization-scoped dataset. Returns predicate/model assessments, not a monetary forecast. Use with fin |
| `calculate_financial_forecast` | Calculate financial forecast | `method`: enum<br>`currency`: string<br>`periods`: number<br>`periodUnit`: enum<br>`history`: array<br>`growthRates`: array<br>`seasonLength`: number<br>`openingCash`: any<br>`inflows`: array<br>`outflows`: array<br>`scenarios`: array<br>`opening`: object<br>`drivers`: object | Medium | Execute financial forecasts: growth, linear trend, seasonality, rolling cash-flow schedules, scenarios and reconciled simplified three statements. Read source i |
| `compare_financial_snapshots` | Compare financial snapshots | `baseline`: string<br>`current`: string<br>`metricMappings`: array | Low | Compare two saved snapshots by ID or exact name. Currency-separated changes and scope warnings; zero-baseline percentages are unavailable. Optional explicit met |
| `get_financial_snapshot` | Retrieve financial snapshot | `reference`: string | Low | Retrieve saved financial values and assumptions by snapshot ID or exact unambiguous name. Reads frozen values without re-querying accounting sources. |
| `list_financial_snapshots` | List saved financial snapshots | — | Low | List up to 100 saved immutable financial snapshots within this organization and project; drafts are excluded. |
| `propose_financial_snapshot` | Review financial snapshot | — | Low | Prepare a review card to freeze a successful financial calculation/forecast artifact from this CREW room. Never accepts agent-provided metric values. Omit sourc |
| `quickbooks_calculate_total` | Calculate QuickBooks total | `entity`: enum<br>`field`: enum<br>`outstanding`: boolean<br>`overdue`: boolean | Low | Calculate an exact monetary sum across ALL pages of supported QuickBooks records. Specify the monetary field explicitly. Outstanding invoices mean entity Invoic |
| `quickbooks_forecast_cashflow` | Forecast QuickBooks cash flow | `horizonWeeks`: number | Low | Read all scoped QuickBooks bank accounts, unpaid invoices and bills and project a 13-week scheduled cash-flow baseline. A projection of existing dated commitmen |
| `quickbooks_get_company` | QuickBooks company | — | Low | Read the connected QuickBooks Online company. Missing connections can be requested with connect_platform platform quickbooks. |
| `quickbooks_get_record` | Read QuickBooks record | `entity`: enum<br>`id`: string | Low | Read the full selected accounting record by its entity and numeric ID from the same scoped QuickBooks connection. |
| `quickbooks_get_report` | QuickBooks financial report | — | Low | Read profit and loss, balance sheet, cash flow, aged receivables or aged payables from QuickBooks Online. Report values are source data, not financial advice. |
| `quickbooks_list_records` | Find QuickBooks records | `entity`: enum<br>`start`: number<br>`limit`: number<br>`search`: string<br>`overdue`: boolean<br>`outstanding`: boolean | Low | Read customers, vendors, accounts, items, invoices, bills, purchases, payments or estimates. For outstanding/unpaid invoices use entity Invoice and outstanding  |
| `quickbooks_propose_customer` | Propose QuickBooks customer | `display_name`: string<br>`company_name`: string<br>`email`: string<br>`phone`: string<br>`note`: string | Low | Save a review card for a new QuickBooks customer. Only authenticated approval creates the customer record. |
| `quickbooks_propose_invoice` | Propose QuickBooks invoice | — | Medium | Save a review card for an invoice using actual QuickBooks customer and item IDs. Only authenticated approval creates the unpaid invoice. This does not email it, |
| `quickbooks_propose_payment` | Propose QuickBooks payment | `invoice_id`: string<br>`amount`: number<br>`txn_date`: any<br>`note`: string | Low | Save a review card for a customer payment against an open QuickBooks invoice. Only authenticated approval records the payment; it does not move money. |
| `quickbooks_propose_void_invoice` | Propose voiding a QuickBooks invoice | `invoice_id`: string | Low | Save a review card to void an existing QuickBooks invoice. Only authenticated approval voids it; the record stays for audit but its amounts are zeroed and this  |

## Admin: Personality

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `get_agent_personality` | Get Agent Personality | `agentDeploymentId`: number<br>`appDeploymentId`: number | High | Returns the current OCEAN traits, archetype, and persona for an agent deployment or an app deployment. Pass either agentDeploymentId or appDeploymentId. Super A |
| `get_copilot_personality` | Get Copilot Personality | — | High | Returns the current global personality configuration for the Oddjob Assistant/Copilot, including OCEAN traits, archetype, and any system prompt addon. Super Adm |
| `list_agent_personalities` | List Agent Personalities | `type`: enum | High | Returns a summary of personality configurations across all active agent deployments and app deployments. Shows which deployments have custom OCEAN traits vs usi |
| `list_persona_templates` | List Persona Templates | — | High | Returns all built-in agent persona templates (generic, researcher, critic, analyst, creator, strategist, debugger). Each template has a system prompt trait, sug |
| `list_personality_archetypes` | List Personality Archetypes | — | High | Returns all built-in OCEAN personality archetypes available for agents and apps. Each archetype is a named preset of the Big Five (O, C, E, A, N) traits in the  |
| `preview_personality_prompt` | Preview Personality Prompt | `archetype`: string<br>`openness`: number<br>`conscientiousness`: number<br>`extraversion`: number<br>`agreeableness`: number<br>`neuroticism`: number | Low | Generates and returns the full soul prompt that would be injected into an agent's system prompt for a given set of OCEAN traits and archetype. Useful for testin |
| `set_agent_personality` | Set Agent Personality | `agentDeploymentId`: number<br>`appDeploymentId`: number<br>`archetype`: string<br>`openness`: number<br>`conscientiousness`: number<br>`extraversion`: number<br>`agreeableness`: number<br>`neuroticism`: number<br>`systemPrompt`: string | High | Updates the OCEAN traits, archetype, and/or system prompt override for an agent or app deployment. You can pass a named archetype (which auto-fills OCEAN values |
| `set_copilot_personality` | Set Copilot Personality | `archetype`: string<br>`openness`: number<br>`conscientiousness`: number<br>`extraversion`: number<br>`agreeableness`: number<br>`neuroticism`: number<br>`systemPromptAddon`: string | High | Configures the global personality for the Oddjob Assistant/Copilot system agent. Accepts a named archetype and/or individual OCEAN trait values. Optionally adds |

## Agents

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `mount_agent_studio` | Mount Agent Studio | `agentId`: number<br>`agentName`: string<br>`view`: enum | Low | Opens Agent Studio beside the CREW conversation on one of this organization's agents: what it is, the model it runs on, the tools it may call, what it reads, an |
| `propose_agent` | Draft an agent | `instruction`: string<br>`agentId`: number<br>`name`: string<br>`tools`: array<br>`topics`: array | Medium | Drafts an agent from a description, or a change to an existing one, and shows it as a card the person applies. Writes nothing: no agent is created and no permis |

## Airtable

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `airtable_create_record` | Create Airtable Record | `base_id`: string<br>`table_name`: string<br>`fields`: object | Medium | Create a new record in an Airtable table. |
| `airtable_delete_record` | Delete Airtable Record | `base_id`: string<br>`table_name`: string<br>`record_id`: string | High | Delete a record from an Airtable table. Always confirm with user before executing. |
| `airtable_get_record` | Get Airtable Record | `base_id`: string<br>`table_name`: string<br>`record_id`: string | Low | Get a single record from an Airtable table by its record ID. |
| `airtable_list_records` | List Airtable Records | `base_id`: string<br>`table_name`: string<br>`filter_formula`: string<br>`fields`: array<br>`max_records`: number | Low | List records from an Airtable table with optional filtering and field selection. |
| `airtable_update_record` | Update Airtable Record | `base_id`: string<br>`table_name`: string<br>`record_id`: string<br>`fields`: object | Medium | Update fields on an existing Airtable record. |

## Amazon

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `amazon_build_cart` | Build Amazon cart link | `items`: array<br>`marketplace`: string | Low | Build a cart handoff link for specific ASINs and quantities. Opening it in a browser adds the items to that person’s own Amazon cart for them to review and buy. |
| `amazon_compare_products` | Compare Amazon products | `asins`: array<br>`marketplace`: string | Low | Compare up to 10 products by ASIN side by side. Returns each normalized product plus a best-by-price and best-by-rating pick where data exists. |
| `amazon_get_product` | Read Amazon product | `asin`: string<br>`marketplace`: string | Low | Read one product by ASIN — price, availability, merchant, features and images. Read the actual item before recommending or proposing it. |
| `amazon_get_variations` | List Amazon variations | `parent_asin`: string<br>`marketplace`: string | Low | List a product’s variants (size, color, style) from its parent ASIN. Child ASINs are the purchasable items. |
| `amazon_propose_purchase` | Propose Amazon purchase | `marketplace`: string<br>`items`: array<br>`title`: string<br>`reason`: string<br>`max_total`: number | Medium | Create an approval-gated procurement proposal for a set of ASINs. Nothing is bought: on approval, the approver gets a cart link that opens their own Amazon sess |
| `amazon_search_products` | Search Amazon products | `query`: string<br>`category`: string<br>`min_price`: number<br>`max_price`: number<br>`prime_only`: boolean<br>`brand`: string<br>`marketplace`: string<br>`page`: number<br>`page_token`: string<br>`max_results`: number | Low | Search the Amazon catalog for products. Returns normalized items with price, availability and links — indicative data, not a live checkout quote. Use amazon_get |

## Analytics Databases

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `bigquery_list_datasets` | List BigQuery Datasets | `project_id`: string | Low | List available datasets in a BigQuery project. |
| `bigquery_query` | BigQuery SQL Query | `query`: string<br>`project_id`: string<br>`location`: string<br>`limit_rows`: number | Medium | Execute a SQL query against Google BigQuery. Returns up to 500 rows. Use for large-scale analytics on GCP. |
| `snowflake_list_tables` | List Snowflake Tables | `database`: string<br>`schema`: string | Low | List tables in a Snowflake database/schema to discover available data. |
| `snowflake_query` | Snowflake SQL Query | `query`: string<br>`warehouse`: string<br>`database`: string<br>`schema`: string<br>`limit_rows`: number | Medium | Execute a SQL query against a Snowflake data warehouse. Returns up to 500 rows. Use for large-scale analytics and reporting queries. |

## App Forge

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `apply_app_change` | Apply a change to a mounted app | `appId`: number<br>`instruction`: string<br>`view`: enum<br>`galleryMigration`: boolean | Low | Applies a described change to an app already open in the App Studio, then rebuilds it. Returns the studio surface with the outcome attached, so the mounted pod  |
| `apply_gallery_migration` | Apply an approved gallery migration | `appId`: number<br>`snapshotId`: string | Low | Applies a migration previously proposed for this app, verifies the result, and rolls the whole thing back if verification fails. Requires the snapshot id return |
| `diagnose_forge_job` | Diagnose Forge Job | `jobId`: string | Low | Performs a forensic diagnostic of an App Forge job using its ID. Correlates Redis state, database records, and event logs to identify hangs, desyncs, or silent  |
| `forge_edit_file` | Forge: Edit File | `slug`: string<br>`filePath`: string<br>`content`: string | Low | Edits or creates a file in the forge workspace. |
| `forge_inject_build_config` | Forge: Inject Build Config | `slug`: string<br>`blueprintSlug`: string | Low | Injects required build configuration into a forge workspace: next.config.js (with ignoreBuildErrors), tsconfig.json (with path aliases), src/lib/utils.ts (cn he |
| `forge_marketplace_publish` | Forge: Publish to Marketplace | `slug`: string<br>`name`: string<br>`description`: string<br>`missionRunId`: number | Low | Finalizes a forged app and publishes it to the marketplace. This triggers the final deployment and sends a notification to the user with the live link. |
| `forge_npm_command` | Forge: NPM Command | `slug`: string<br>`command`: string | Low | Runs an NPM command (install, build, test) in the forge workspace. |
| `forge_sanitize_deps` | Forge: Sanitize Dependencies | `slug`: string<br>`blueprintSlug`: string | Low | Strips AI-hallucinated or internal packages from a forge workspace's package.json. Uses the blueprint as the source-of-truth allowlist, supplemented by known-sa |
| `forge_trigger` | Forge Trigger (Recursive Spawn) | `blueprint`: string<br>`name`: string<br>`slug`: string<br>`description`: string<br>`missionId`: number<br>`blackboard`: object | Low | Recursively spawns a sub-app to handle a specific feature gap or sub-task. Increments the forge depth to prevent infinite loops. Use this when a larger app requ |
| `forge_validate_workspace` | Forge: Validate Workspace | `slug`: string | Low | Pre-flight validation of a forge workspace before Docker build. Checks for required files (package.json, Dockerfile, next.config.js, tsconfig.json, src/lib/util |
| `get_code_metrics` | Forge: Get Code Metrics | `slug`: string | Low | Returns health metrics for an app's codebase, including parse errors, function counts, and export density. |
| `inspect_app_scaffold` | Inspect an app's scaffold | `appId`: number | Low | Reads an existing app's workspace and classifies it as gallery-native, gallery-compatible, legacy, custom or unhealthy, with the files a migration could touch a |
| `list_blueprints` | Forge: List Blueprints | `category`: string | Low | Lists available application architectures (blueprints) that can be used to scaffold a new app. Blueprints include 'analytics-dashboard', 'chat-assistant', 'crud |
| `list_installed_apps` | List Org Apps | — | Low | Returns the app catalog for the current organization: installed/live App Forge deployments, active Agent AI deployments, advertised marketplace apps that can be |
| `list_scaffold_packs` | List Available Scaffold Packs | — | Low | Lists every scaffold pack in the registry with its id, category, what it provides and what it requires. Call this before proposing a deployment so the pack ids  |
| `mount_app_studio` | Mount App Studio (Forge / Builder) | `mode`: enum<br>`appId`: number<br>`appName`: string<br>`view`: enum<br>`title`: string<br>`requirements`: string<br>`jobId`: string | Low | Mounts the App Studio beside the CREW conversation. Use mode 'builder' to open an existing app for inspection, modification, diagnosis or publishing — pass appI |
| `propose_assembly_deployment` | Propose Scaffolding a New App From the Assembly Stack | `appName`: string<br>`displayName`: string<br>`packs`: array<br>`reason`: string<br>`publish`: boolean<br>`accessPolicy`: enum<br>`designStyleId`: string<br>`aiEmbellishment`: string | High | Proposes scaffolding a NEW forged application from the room's assembled scaffold packs. Requires a real application name — the packs describe what to build, not |
| `propose_gallery_migration` | Propose a Component Gallery migration | `appId`: number | Low | Inspects an app, snapshots the files a migration would touch, and returns the proposed change as a diff. Applies nothing — the author reviews first. |
| `query_code_graph` | Forge: Query Code Graph | `slug`: string<br>`kind`: string<br>`mode`: enum | Low | Queries the code graph for a specific app to understand its structure. |
| `revert_app_change` | Revert the last app change | `appId`: number | Low | Restores the workspace backup taken before the last applied change. Use when the author asks to undo. |
| `scaffold_mini_app` | Scaffold Mini App | `blueprint`: string<br>`name`: string<br>`slug`: string<br>`description`: string<br>`theme`: string<br>`oddjobMissionId`: number | Low | Creates a new mini-app from a blueprint template and registers it in the app registry. |
| `search_hil_context` | Search HIL Context | `query`: string<br>`limit`: number | Low | Searches past Human-in-the-Loop decisions for relevant context. |
| `start_app_forge` | Start an App Forge build | `name`: string<br>`description`: string<br>`blueprint`: string<br>`slug`: string<br>`projectId`: number | Medium | Begins a forge run for a new application and returns the studio attached to it. Provisions a container and runs the full generation pipeline, so it is dispatche |
| `studio_enhance_app` | Studio: Enhance App | `appId`: number<br>`instruction`: string | Low | Applies AI-generated code changes to a forged app, then rebuilds and restarts its container. Provide a natural language instruction describing the desired chang |
| `studio_list_files` | Studio: List App Files | `slug`: string | Medium | Lists the file tree of a forged app's workspace. Skips node_modules, .next, dist, and .git. Returns a nested tree of files and directories with sizes and extens |
| `studio_read_file` | Studio: Read App File | `slug`: string<br>`filePath`: string | Low | Reads the content of a specific file from a forged app's workspace. Use studio_list_files first to discover available paths. Returns raw file content as a strin |
| `synthesize_app_from_process` | Build an Assembly Draft From an Attached Process | `attachmentId`: number | Low | Turn an attached BPMN file, workflow diagram, flowchart, or process image into an assembly draft shown as a workflow diagram: inputs, pipeline steps in order, b |

## Authoring

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `mount_scribe_studio` | Mount Scribe Studio Authoring Pod | `title`: string<br>`archetypeMode`: enum<br>`targetWordCount`: number<br>`initialPrompt`: string<br>`subject`: string<br>`reset`: boolean | Low | Mounts the 4-pane Scribe Studio authoring pod in the CREW room with a vertical subway branch spine and paginated living canvas. |
| `scribe_add_table_of_contents` | Add or Refresh Scribe Table of Contents | `documentId`: number | Medium | Add or refresh a Table of Contents from the active document's headings, preserving all existing sections and text. Use for 'add a TOC'; do not remount or reset  |
| `scribe_configure_stations` | Configure Scribe Document Stations | `documentId`: number<br>`stations`: array | Low | Reconfigures the document outline/stations (e.g. from a user-provided Table of Contents or outline). Creates or updates stations with custom titles, keys, and s |
| `scribe_export_manuscript` | Compile & Export Manuscript | `documentId`: number<br>`format`: enum<br>`branchId`: number | Low | Compiles all stations in the active Scribe Studio document into formatted Markdown, PDF, or Word DOCX. |
| `scribe_fork_branch` | Fork Scribe Subway Branch | `documentId`: number<br>`stationKey`: string<br>`branchName`: string<br>`description`: string<br>`spawnBreakoutRoom`: boolean | Low | Forks a new subway track branch to explore an alternate plot twist, counterparty concession, or architectural option. |
| `scribe_get_document` | Read Active Scribe Document | `documentId`: number | Medium | Read the current manuscript, section IDs, and text before editing. Omit documentId to use the current room. Does not create or reset a document. |
| `scribe_import_confluence_page` | Import a Confluence Page into Scribe | `credentialId`: number<br>`pageId`: string<br>`documentId`: number | Low | Import a Confluence page into the active Scribe document, splitting it into stations at its heading level. Replaces the current outline, so read scribe_get_docu |
| `scribe_publish_to_confluence` | Publish Scribe Manuscript to Confluence | `credentialId`: number<br>`spaceKey`: string<br>`pageId`: string<br>`title`: string<br>`documentId`: number | Medium | Compile the active manuscript and publish it to a Confluence space. Pass pageId to update an existing page in place; omit it to create a new one. |
| `scribe_reconcile_continuity` | Reconcile Document Continuity | `documentId`: number<br>`sourceSortOrder`: number<br>`sourceContent`: string<br>`sourceStationKey`: string<br>`branchId`: number | Low | Runs forward-propagation causality analysis across downstream stations to detect contradictions caused by upstream branch edits. |
| `scribe_reset_studio` | Reset Scribe Studio Document | `documentId`: number<br>`newTitle`: string<br>`archetypeMode`: enum<br>`targetWordCount`: number | Low | Resets the active Scribe Studio document when the subject or topic changes, clearing previous stations, annotations, and text. |
| `scribe_run_critic_pass` | Run Multi-Lens Critic Evaluation | `documentId`: number<br>`nodeId`: number<br>`lenses`: array | Low | Evaluates the document against specialized persona lenses (Legal Sentinel, Stylistic Pal, Pacing Auditor, Devil's Advocate). |
| `scribe_update_node` | Update Scribe Station Content | `nodeId`: number<br>`content`: string<br>`targetExcerpt`: string<br>`replacementExcerpt`: string<br>`status`: enum | Low | Updates the text content of a specific station or clause in the active Scribe Studio document. Can replace full content or surgically replace targetExcerpt with |

## CREW

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `propose_crew_claim` | Propose CREW Claim | `claim`: string<br>`confidence`: number<br>`evidence`: array<br>`reason`: string | Low | Propose a durable claim with evidence and confidence for the room evidence ledger. Requires human approval. |
| `propose_crew_commitment` | Propose CREW Commitment | `title`: string<br>`detail`: string<br>`ownerType`: enum<br>`ownerId`: string<br>`dueAt`: string<br>`ontologyRefs`: array<br>`reason`: string | Low | Propose an owned, trackable room commitment. Requires human approval. |
| `propose_crew_decision` | Propose CREW Decision | `statement`: string<br>`rationale`: string<br>`alternatives`: array<br>`confidence`: number<br>`ontologyRefs`: array<br>`reason`: string | Low | Propose a durable room decision with rationale, alternatives, confidence, and ontology references. Requires human approval. |

## Calculations

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `propose_calculation_eval` | Propose Neuro-Symbolic Calculation Evaluation | `formulaName`: string<br>`constraints`: array<br>`inputVariables`: object<br>`reason`: string | Low | Proposes running an AST formula calculation, constraint optimization, or probabilistic sensitivity evaluation over knowledge graph nodes. |

## Cloud

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `cloud_invoke_function` | Invoke Cloud Function | `provider`: enum<br>`functionName`: string<br>`payload`: object | Medium | Invoke an AWS Lambda or GCP Cloud Function and return its response. |
| `cloud_list_functions` | List Cloud Functions | `provider`: enum | Low | List available Lambda functions or GCP Cloud Functions in a cloud account. |
| `cloud_read_logs` | Read Cloud Logs | `provider`: enum<br>`logGroupName`: string<br>`filterPattern`: string<br>`startTime`: string<br>`endTime`: string | Low | Read log events from AWS CloudWatch Logs. |

## Collaboration

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `add_shared_memory` | Add Shared Memory | `observation`: string<br>`source`: string | Low | Share an observation with other agents in your mission. Use when you discover something useful (e.g. 'Found API key in credential ID 5', 'Competitor X uses pric |
| `get_blackboard` | Get Blackboard | `keys`: array<br>`includeLarge`: boolean | Low | Retrieve the current content of the shared mission blackboard. By default, large fields (tool outputs) are truncated for stability. Use 'keys' to read specific  |
| `launch_mission` | Launch Mission | `reason`: string | Medium | Trigger the execution of the Mission. This will start the Supervisor pipeline which delegates tasks to members based on the active Objective. |
| `synthesize_mission_assets` | Synthesize Mission Assets | `missionId`: number<br>`objective`: string<br>`reasoningRange`: enum | Low | Autonomous Dependency Resolution: Analyzes a mission objective and automatically creates or links all required dependencies (agents, pipelines, datasets, and kn |
| `update_blackboard` | Update Blackboard | `content`: object<br>`reason`: string | Medium | Update the shared 'blackboard' for your mission. Use this to share findings, plans, or status updates with other agents in the same mission. |

## Computer Use

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `mount_computer_studio` | Mount Computer Use Studio | `sessionId`: string<br>`goal`: string<br>`teach`: boolean | Low | Mounts Computer Use Studio in the side rail beside the CREW conversation, allowing visual inspection and live browser/desktop control. |
| `trycua_click` | Click at Coordinates | `sessionId`: string<br>`x`: number<br>`y`: number | Low | Click at the given x,y screen coordinates. Use trycua_screenshot first to identify element positions. |
| `trycua_create_session` | Create Computer Session | `os`: enum<br>`sandboxName`: string | Low | Open a computer session on the organization's desktop (a Linux XFCE desktop with a browser; each organization has its own, started on demand). Returns a session |
| `trycua_dom_extract` | Extract DOM Content | `sessionId`: string<br>`mode`: enum<br>`selector`: string<br>`attribute`: string<br>`limit`: number<br>`tabUrl`: string<br>`ingestKnowledgeGraph`: boolean | Low | Extract structured text or element attributes from the active browser tab via the DevTools Protocol (CDP). Significantly faster and more accurate than screensho |
| `trycua_end_session` | End Computer Session | `sessionId`: string | High | Terminate a computer session and release its resources. Always call this when the task is complete. |
| `trycua_file_upload` | Upload File | `sessionId`: string<br>`path`: string | Low | Upload a file from a path inside the sandbox into an open file dialog. Only available on Cua cloud sandboxes, not on Oddjob-managed desktops. |
| `trycua_find_element` | Find Element on Screen | `sessionId`: string<br>`query`: string | Low | Use vision AI to find the coordinates of an element on the screen matching the query. |
| `trycua_key_press` | Press Key | `sessionId`: string<br>`key`: string | Low | Press a key or a key combination. Examples: 'Enter', 'Tab', 'Escape', 'PageDown', 'ctrl+c', 'ctrl+shift+t'. Combinations are joined with '+'. |
| `trycua_list_skills` | List Learned Computer Skills | `status`: enum | Low | List the organization's learned computer-use skills: browser procedures recorded from a person's actions and approved by an admin. Pass a skill's id to trycua_r |
| `trycua_navigate` | Navigate Browser | `sessionId`: string<br>`action`: enum<br>`url`: string | Low | Open an http(s) URL in the desktop's browser (a new tab if it is already open), or go back/forward/refresh. |
| `trycua_observe` | Observe Screen (Vision) | `sessionId`: string | Medium | Take a screenshot and run Gemini Vision OCR to identify visible text, UI elements, and interactive regions. More detailed than trycua_screenshot alone. |
| `trycua_run_task` | Run Computer Task | `sessionId`: string<br>`task`: string<br>`skillId`: string<br>`skillInputs`: object<br>`maxSteps`: number<br>`previousTaskId`: string | Low | Give the computer-use agent a goal in plain language (e.g. 'Open linkedin.com and list my three newest notifications'). If an approved learned skill matches, it |
| `trycua_save_task_as_skill` | Save Computer Task as Skill | `taskId`: string<br>`name`: string<br>`goal`: string | Medium | Save the steps of a computer-use task as a draft learned skill. Works for runs that acted on a page (a recorded URL and element); a run that clicked screen coor |
| `trycua_screenshot` | Take Screenshot | `sessionId`: string | Low | Capture the current screen as a base64-encoded PNG. Call this after every action to verify the result before proceeding. |
| `trycua_scroll` | Scroll Screen | `sessionId`: string<br>`deltaX`: number<br>`deltaY`: number | Low | Scroll at the mouse pointer by mouse-wheel clicks (roughly 50-100px each). Positive deltaY scrolls down; negative scrolls up. |
| `trycua_teach_task` | Teach a Browser Task | `goal`: string<br>`sessionId`: string | Low | Open Teach a Task in Computer Use Studio when the user wants to demonstrate or teach a browser workflow. The user starts recording, edits variables and outputs, |
| `trycua_type_text` | Type Text | `sessionId`: string<br>`text`: string | Low | Type text into the currently focused input field. Click the target field first, then call this tool. |
| `trycua_wait` | Wait | `sessionId`: string<br>`ms`: number | Low | Pause for a number of milliseconds. Use to wait for page loads or animations. |
| `trycua_window` | Window Management | `sessionId`: string<br>`action`: enum<br>`title`: string | Low | Maximize or minimize the active window. Focusing a window by title is only available on Cua cloud sandboxes. |

## Control Flow

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `sleep` | Sleep / Delay | `seconds`: number<br>`reason`: string | Low | Suspend execution for a specified duration. |

## Core Capabilities

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `calculator` | Calculator | `expression`: string | Low | Perform basic arithmetic calculations. |
| `current_time` | Current Time | — | Low | Get the current server time (ISO string). |
| `get_document_relationships` | Understand Relationships | `topicId`: number<br>`topicName`: string<br>`documentId`: number | Low | Find jobs, pipelines, and datasets linked to a Knowledge Store document or topic. Use this to show users which automations use their knowledge. |
| `get_job_schema` | Get Job Schema | `jobType`: string | Low | Get the full configuration schema for a specific job type. Returns required fields, optional fields, types, and examples. Use this to understand how to configur |
| `get_pipeline_variable_syntax` | Get Pipeline Variable Syntax | — | Low | Get reference documentation for pipeline variable syntax. Learn how to pass data between steps using {{steps.N.output}} syntax. |
| `http_request` | HTTP Request | `method`: enum<br>`url`: string<br>`headers`: object<br>`body`: string | Low | Make an HTTP request to an external API (GET, POST, etc). |
| `request_execute_mode` | Request Execute Mode | `reason`: string | Medium | Request the user to switch the Assistant to Execute mode to carry out side-effect actions. Use this after you have a solid plan and are ready to run it. |

## Datasets & External

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `add_dataset_items` | Add Items | `datasetId`: number<br>`items`: array | Medium | Add JSON items to an existing dataset. |
| `calculate_dataset_metric` | Calculate Dataset Metric | `datasetId`: number<br>`datasetName`: string<br>`numericField`: string<br>`aggregation`: enum<br>`filters`: array | Low | Compute an aggregate (avg, sum, median, min, max, count) over one numeric field of a dataset, with optional equality filters. Returns the value together with ho |
| `create_dataset` | Create Dataset | `name`: string<br>`description`: string<br>`tags`: array | Medium | Create a new empty dataset container. |
| `external_sql_query` | External DB Query | `credentialId`: number<br>`query`: string<br>`params`: array | High | Execute a SQL query against an EXTERNAL database using a stored credential. CRITICAL: Use parameters ($1, $2, etc.) for any user-provided data to prevent SQL in |
| `get_dataset_details` | Get Dataset Details | `datasetId`: number<br>`datasetName`: string | Low | Get details and sample items from a dataset. |
| `get_dataset_items` | Get Dataset Records | `datasetId`: number<br>`limit`: number<br>`offset`: number<br>`filterField`: string<br>`filterValue`: string | Low | Retrieve rows from a dataset, optionally filtered on one field. Use to inspect actual records before computing anything over them. |
| `list_datasets` | List Datasets | `search`: string<br>`limit`: number | Low | List available datasets with metadata and item counts. |
| `query_dataset` | Query Dataset | `datasetId`: number<br>`limit`: number<br>`offset`: number | Low | Retrieve items from a dataset. |
| `run_prediction` | Run Prediction | `csvPath`: string<br>`datasetId`: number<br>`limit`: number | Medium | Run prediction intelligence on a dataset or CSV file. This will use the Hidden State and Prediction Pods to analyze data and generate predictions. |

## Deliberation

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `propose_decision_matrix` | Propose Multi-Criteria Decision Matrix | `topic`: string<br>`candidates`: array<br>`criteria`: array<br>`personaStances`: array<br>`recommendedCandidateId`: string<br>`consensusPercentage`: number | Low | Mounts or updates an interactive Decision Matrix Rail in the CREW room with candidate options, weighted criteria, scoring breakdown, and persona stances. |
| `ratify_decision` | Ratify Durable Decision | `statement`: string<br>`rationale`: string<br>`alternatives`: array<br>`confidence`: number<br>`evidenceTurnIds`: array | Low | Formally proposes or ratifies a strategic or architectural decision in the room with evaluated alternatives, rationale, and confidence score. |
| `record_commitment` | Record Action Commitment | `title`: string<br>`detail`: string<br>`ownerType`: enum<br>`ownerId`: string<br>`dueAt`: string | Low | Locks in an explicit action commitment or responsibility for an agent or participant with target deadline and expected deliverables. |
| `verify_claim` | Verify Empirical Claim | `claim`: string<br>`confidence`: number<br>`agreementLevel`: number<br>`evidence`: array<br>`positions`: array | Low | Asserts an empirical claim or fact with backing evidence citations and multi-agent stance tracking. |

## Diagnostics

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `pin_forensic_event` | Pin Forensic Timeline Event | `incidentTitle`: string<br>`eventTimestamp`: string<br>`severity`: enum<br>`source`: string<br>`description`: string<br>`hypothesis`: object | Low | Pins a chronological event, error log anomaly, or root cause hypothesis card into the Forensic Incident Timeline Rail. |

## Discovery

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `discover_capabilities` | Discover Capabilities | `query`: string<br>`limit`: number | Low | Discover which Oddjob missions are available to fulfil a request, each with its purpose, when to use it, and the inputs it needs. ALWAYS call this before tellin |
| `discover_capability_proposals` | Discover Proposed Capabilities | `query`: string<br>`limit`: number | Low | List Evolution-discovered capability proposals that are NOT executable. Use this to explain capability gaps and proposed enhancements without presenting them as |
| `propose_mission` | Propose Mission Launch | `missionId`: number<br>`reason`: string<br>`inputs`: object | Medium | Propose launching a specific mission (by id, obtained from discover_capabilities) to fulfil the user's request. This does NOT run the mission — it creates a pro |
| `propose_mission_synthesis` | Propose Mission Synthesis | `request`: string<br>`reason`: string | Medium | When discover_capabilities finds NO existing mission that fits the user's request, propose SYNTHESIZING a new one via GMS. This does NOT run anything — it creat |
| `propose_research_mission` | Propose Research Mission | `question`: string<br>`reason`: string<br>`topic`: string | Medium | When you CANNOT answer a user's question from the knowledge base or web search, propose running a RESEARCH MISSION that investigates the question and saves the  |

## Document Processing

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `pdf_extract_metadata` | Extract PDF Metadata | `source`: string | Low | Extract metadata from a PDF file (author, title, page count, creation date, etc.). |
| `pdf_extract_text` | Extract PDF Text | `source`: string<br>`pages`: string<br>`preserve_layout`: boolean | Low | Extract plain text content from a PDF file stored in the file system or accessible via URL. |

## Documentation

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `get_confluence_page` | Read Confluence Page | `credentialId`: number<br>`pageId`: string | Low | Read the full content of a Confluence page by ID. The content will be returned as Markdown. |
| `get_xray_spec` | Get X-Ray Spec | `node`: string<br>`offset`: number | Low | Read the full architecture spec written for a specific X-Ray node — the authoritative documentation for how an app, scope or screen is built. This is an EXACT l |
| `list_xray_specs` | List X-Ray Specs | `nodeType`: string | Low | List the architecture specs documented for this organization's X-Ray nodes — the authoritative written documentation for apps, scopes and screens. Returns node  |
| `search_confluence` | Search Confluence | `credentialId`: number<br>`query`: string | Low | Search for pages in the locked Confluence space. Use this to find relevant specs or documentation by title or keywords. |

## Files & Storage

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `analyze_image` | Analyze Image | `filePath`: string | Low | Analyze an image file. Use this when you need to 'see' a diagram, screenshot, or chart. The image data will be attached to your context for the NEXT turn. |
| `file_list` | List Files (Storage) | `path`: string<br>`recursive`: boolean | Low | List files in a directory within the organization storage. |
| `file_read` | Read File (Storage) | — | Low | Read the content of a file from organization storage. **MANDATORY**: You must provide the 'path' parameter as a relative path to the file. |
| `file_write` | Write File (Storage) | — | Medium | Write content to a file in storage. |
| `google_doc_read` | Read Google Doc | `fileId`: string | Low | Read the content of a Google Doc. Requires a Google Drive credential. |
| `list_system_files` | List System Files | `path`: string | High | List files in ANY directory on the server's filesystem (Absolute Path). ADMIN ONLY. |
| `read_system_file` | Read System File | `path`: string | High | Read ANY file on the server's filesystem (Absolute Path). ADMIN ONLY. |

## Finance

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `calculate_asc606_amortization` | calculate_asc606_amortization | `contract`: any | Low | Applies the ASC 606 5-Step Model to compute monthly recognized revenue waterfalls and unearned balances. |
| `generate_journal_entries` | generate_journal_entries | `schedule`: any<br>`targetPeriod`: string | Low | Generates double-entry General Ledger journal entries (Deferred Revenue debit vs Recognized Revenue credit). |
| `ingest_subscription_contracts` | ingest_subscription_contracts | `contracts`: array<br>`sampleCount`: number | Low | Ingests subscription contracts, billing schedules, and performance obligations. |
| `record_audit_ledger_proof` | record_audit_ledger_proof | `contractId`: string<br>`period`: string<br>`entries`: array<br>`attestationRole`: string | Low | Seals and records a SHA-256 cryptographic audit proof ledger for financial compliance audits. |

## Flows

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `mount_flow_studio` | Mount Flow Studio | `flowName`: string<br>`flowId`: number | Low | Mounts Flow Studio in the side-rail beside the CREW conversation, allowing visual inspection and topological simulation of flows and pipelines. Pass 'flowName'  |
| `propose_flow` | Draft a Flow | `name`: string<br>`instruction`: string<br>`steps`: array | Medium | Drafts a flow — an ordered sequence of this organization's existing jobs — and returns it as a card for a person to create. Writes nothing; the person presses C |

## Formal Methods & Verification

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `prove_mission_schedulability` | Prove Mission Schedulability | `missionPlan`: object | Low | Formally verifies multi-agent mission cycles are deadlock-free on shared resource locks and remain strictly within provider token rate limits across continuous  |
| `prove_workflow_safety` | Prove Workflow Safety Guard | `workflowGraph`: object<br>`userRoles`: array | Low | Uses Constrained Horn Clauses and Model Checking to prove an agent workflow graph cannot bypass HIL guards or violate the Zero Hallucinated Evidence rule. |
| `synthesize_accessible_tokens` | Synthesize Accessible Tokens | `seedHex`: string | Low | Mathematically synthesizes WCAG 2.2 AA compliant Light and Dark mode tokens (Contrast Ratio >= 4.5:1) from any seed brand hex color. |
| `verify_and_synthesize_layout` | Verify and Synthesize Layout | `layoutTree`: any<br>`viewport`: object | Low | Formally proves UI geometric invariants (containment, non-overlap, ergonomic bounds) across continuous viewport spectrum W ∈ [320, 2560] and auto-synthesizes cl |

## Forms

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `apply_form_change` | Apply a Form Change | `formId`: number<br>`baseRevision`: number<br>`proposalId`: string<br>`definition`: object<br>`summary`: string | Low | Saves a change the author approved on its diff card as a new revision of the form. Refused when the form has changed since the change was drafted. |
| `create_form_from_proposal` | Create a Drafted Form | `proposalId`: string<br>`name`: string<br>`instruction`: string<br>`definition`: object | Medium | Creates the form a new-form card holds as a Form Studio draft, after the author pressed Create draft. |
| `mount_form_studio` | Mount Form Studio | `formId`: number<br>`formName`: string<br>`view`: enum | Low | Opens Form Studio beside the CREW conversation on one of this organization's forms: questionnaires, assessments, scorecards, intake and review forms, with their |
| `propose_form_change` | Draft a Form Change | `formId`: number<br>`instruction`: string | Low | Drafts a change to a form against its current revision and returns it as a diff for the author to apply. Writes nothing. |
| `propose_new_form` | Draft a New Form | `instruction`: string<br>`autoScribeDraft`: boolean<br>`scribeDocumentId`: string | Medium | Drafts a new Form Studio form (a calculator, intake form, questionnaire, survey, assessment, scorecard or checklist) from a request and returns it as a card for |
| `share_published_form` | Share a Published Form | `formId`: number<br>`formName`: string | Low | Shows one of this organization's published forms in the conversation so the person can fill it in there. Pass formName with the form's name, or formId. Only pub |

## GMS

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `gms_compose_mission` | GMS: Compose Mission | `goal`: string | Medium | Phase 4: Automatically compose a complex mission blueprint by assembling validated skills from the library. |
| `gms_evolve_skill` | GMS: Evolve Skill | `skillId`: string | Medium | Phase 4: Evolve a skill using genetic algorithms to improve its success rate or adapt it to new conditions. |
| `gms_find_skills` | GMS: Find Skills | `query`: string<br>`limit`: number<br>`requiredTags`: array | Low | Phase 4: Search the Skill Library semantically for validated mission components and reusable skills. |
| `gms_get_status` | GMS: Get Status | — | Low | Get the current health and metrics of the GMS engine phases. |
| `gms_score_blueprint` | GMS: Score Blueprint | `blueprint`: object | Low | Phase 1: Score a mission blueprint using the Neural Mission Verifier to predict success probability and identify risk factors. |
| `gms_shadow_validate` | GMS: Shadow Validate | `candidates`: array<br>`variationsPerCandidate`: number<br>`isolationLevel`: enum | Medium | Phase 3: Run isolated shadow validations (sandbox simulations) for mission candidates to establish ground truth. |
| `gms_synthesize_missions` | GMS: Synthesize Missions | `request`: string<br>`nCandidates`: number<br>`topK`: number<br>`context`: object | Low | Phase 2: Generate diverse mission candidates (blueprints) from a natural language request using Predictive Mission Intelligence (PMI). |

## Generation

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `ai_translate` | AI Translate | `text`: string<br>`targetLanguage`: string<br>`sourceLanguage`: string | Low | Translate text from one language to another using AI. Preserves formatting and tone. |
| `generate_excel` | Generate Excel | `path`: string<br>`data`: array<br>`sheets`: array<br>`sheetName`: string<br>`themeId`: enum<br>`autoFilter`: boolean<br>`includeSummaryRow`: boolean | Low | Generate an Excel (.xlsx) file from structured data (JSON) and save it to storage. |
| `generate_google_doc` | Create Google Doc | `title`: string<br>`content`: string | Medium | Create a new Google Doc from content. Requires a Google Drive connection. |
| `generate_image` | Generate Image | `path`: string<br>`prompt`: string<br>`title`: string<br>`aspectRatio`: enum | Low | Generate an image from a text prompt and render it inline in the assistant chat. The generated image appears immediately as a visual artifact in the chat turn.  |
| `generate_mermaid_diagram` | Generate Diagram | `path`: string<br>`code`: string<br>`title`: string | Low | Generate a Mermaid.js diagram (Flowchart, Sequence, ERD, etc.) and save it to storage. |
| `generate_pdf` | Generate PDF | `path`: string<br>`content`: string<br>`title`: string<br>`themeId`: enum<br>`formatCategory`: enum<br>`useCreativeCrew`: boolean | Low | Generate a polished PDF file from Markdown, HTML, or Creative Crew Document AST and save it to storage. |
| `generate_powerpoint` | Generate PowerPoint (.pptx) | `path`: string<br>`content`: string<br>`title`: string<br>`themeId`: enum<br>`formatCategory`: enum | Low | Generate a native, editable Microsoft PowerPoint presentation (.pptx) matching design system themes and block layouts. |
| `generate_presentation_deck` | Generate Presentation Deck | `title`: string<br>`content`: string<br>`themeId`: enum<br>`formatCategory`: enum<br>`sourceQuery`: object | Low | Assembles visual presentation deliverables (slide decks, magazine ads, documents, executive briefs) using 4-agent creative crew and atomic block layout engine. |
| `generate_word` | Generate Word | `path`: string<br>`content`: string<br>`title`: string<br>`themeId`: enum<br>`formatCategory`: enum<br>`useCreativeCrew`: boolean | Low | Generate a styled Word (.docx) document from text, Markdown, or Creative Crew Document AST and save it to storage. |
| `update_document_ast` | Update Document AST | `ast`: object<br>`operation`: any | Medium | Applies conversational in-place mutations (modify block, add block, remove block, reorder blocks, change theme) to an existing Document AST. |

## Git Workspace

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `git_commit` | Git Commit | `message`: string<br>`files`: array | Medium | Stage specified files (or all changes) and create a commit with the given message. |
| `git_create_branch` | Create Git Branch | `branch_name`: string<br>`base_branch`: string | Medium | Create and switch to a new Git branch for this ticket/feature. Always branch off the latest main/develop. |
| `git_diff` | Git Diff | `staged`: boolean<br>`file`: string | Low | Show the diff of changes in the workspace. Useful to review what you've written before committing. |
| `git_push` | Git Push | `force`: boolean | Low | Push the current branch to origin. Sets upstream tracking on first push. |
| `git_status` | Git Status | — | Low | Show the current git status including branch name, staged/unstaged changes, and untracked files. |
| `workspace_health_check` | Workspace Health Check | `checks`: array | Medium | Pre-flight validation of the coding workspace. Checks: git repo exists, dependencies installed, test runner works, build compiles, lint passes. Run this BEFORE  |
| `workspace_list_files` | List Files in Directory | `path`: string<br>`recursive`: boolean | Low | List files and directories at a given path in the workspace. Excludes node_modules, .git, .next, dist. |
| `workspace_patch_file` | Patch File | `path`: string<br>`old_content`: string<br>`new_content`: string | Medium | Make a targeted edit to a file by replacing a specific string/code block with new content. More efficient than rewriting the entire file. The old_content must m |
| `workspace_read_file` | Read Code File | `path`: string | Low | Read the content of a source code file from the Git workspace. Path is relative to the project root. |
| `workspace_run_command` | Run Command in Workspace | `command`: string<br>`timeout_ms`: number | High | Execute a shell command within the Git workspace directory. Use for: npm run build, npm test, npx tsc --noEmit, npm run lint, etc. Commands run with cwd set to  |
| `workspace_search` | Search Code | `pattern`: string<br>`path`: string<br>`file_pattern`: string<br>`max_results`: number | Low | Search for a text pattern or regex across the workspace codebase. Returns matching lines with file paths and line numbers. Excludes node_modules, .git, dist, .n |
| `workspace_tree` | Project Structure | `path`: string<br>`depth`: number | Low | Show the project directory tree structure (condensed). Useful for understanding project layout before writing code. Excludes node_modules, .git, .next, dist. |
| `workspace_write_file` | Write Code File | `path`: string<br>`content`: string | High | Write or overwrite a source code file in the Git workspace. Creates directories as needed. Path is relative to the project root. |

## GitHub

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `github_create_issue` | Create GitHub Issue | `owner`: string<br>`repo`: string<br>`title`: string<br>`body`: string<br>`labels`: array<br>`assignees`: array | Medium | Create a new issue in a GitHub repository. |
| `github_create_pr` | Create Pull Request | `owner`: string<br>`repo`: string<br>`title`: string<br>`head`: string<br>`base`: string<br>`body`: string | Medium | Create a new pull request in a GitHub repository. |
| `github_get_pr_reviews` | Get PR Reviews | `owner`: string<br>`repo`: string<br>`prNumber`: number | Low | Get review status and comments for a pull request. |
| `github_list_issues` | List GitHub Issues | `owner`: string<br>`repo`: string<br>`state`: enum<br>`labels`: string | Low | List issues in a GitHub repository. |
| `github_list_prs` | List Pull Requests | `owner`: string<br>`repo`: string<br>`state`: enum | Low | List pull requests in a GitHub repository. |
| `github_merge_pr` | Merge Pull Request | `owner`: string<br>`repo`: string<br>`prNumber`: number<br>`mergeMethod`: enum | Low | Merge a pull request in a GitHub repository. |
| `github_request_review` | Request PR Review | `owner`: string<br>`repo`: string<br>`prNumber`: number<br>`reviewers`: array | Low | Request reviewers for a pull request. |

## Google Workspace

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `gcal_create_calendar` | gcal create calendar | `summary`: string<br>`description`: string<br>`timeZone`: string | Low | Propose a Google Calendar change for human approval. Never claims execution before approval. Read existing events first for their ID and etag. Recurring master  |
| `gcal_create_event` | gcal create event | `calendar_id`: string<br>`event`: any<br>`send_updates`: enum<br>`add_meet`: boolean | Low | Propose a Google Calendar change for human approval. Never claims execution before approval. Read existing events first for their ID and etag. Recurring master  |
| `gcal_delete_calendar` | gcal delete calendar | `calendar_id`: any | Low | Propose a Google Calendar change for human approval. Never claims execution before approval. Read existing events first for their ID and etag. Recurring master  |
| `gcal_delete_event` | gcal delete event | `calendar_id`: string<br>`event_id`: string<br>`etag`: string<br>`send_updates`: enum | Low | Propose a Google Calendar change for human approval. Never claims execution before approval. Read existing events first for their ID and etag. Recurring master  |
| `gcal_list_calendars` | List Google Calendars | `page_token`: string | Low | List calendars from the connected Google account. This is Google Calendar, not Microsoft Calendar. |
| `gcal_list_events` | List Google Calendar Events | `calendar_id`: string<br>`time_min`: string<br>`time_max`: string<br>`time_range`: enum<br>`query`: string<br>`max_results`: number<br>`page_token`: string | Medium | Read Google Calendar events. Prefer time_range today/this_week/next_week resolved in the calendar time zone; this_week starts Monday. Or provide an explicit tim |
| `gcal_move_event` | gcal move event | `calendar_id`: string<br>`event_id`: string<br>`destination`: string<br>`send_updates`: enum | Low | Propose a Google Calendar change for human approval. Never claims execution before approval. Read existing events first for their ID and etag. Recurring master  |
| `gcal_respond_event` | gcal respond event | `calendar_id`: string<br>`event_id`: string<br>`response`: enum<br>`etag`: string<br>`send_updates`: enum | Low | Propose a Google Calendar change for human approval. Never claims execution before approval. Read existing events first for their ID and etag. Recurring master  |
| `gcal_update_calendar` | gcal update calendar | `calendar_id`: string<br>`summary`: string<br>`description`: string<br>`timeZone`: string | Low | Propose a Google Calendar change for human approval. Never claims execution before approval. Read existing events first for their ID and etag. Recurring master  |
| `gcal_update_event` | gcal update event | `calendar_id`: string<br>`event_id`: string<br>`event`: any<br>`etag`: string<br>`send_updates`: enum | Low | Propose a Google Calendar change for human approval. Never claims execution before approval. Read existing events first for their ID and etag. Recurring master  |
| `gdocs_append_text` | gdocs_append_text | `document_id`: any<br>`required_revision_id`: any<br>`text`: string<br>`tab_id`: any | Low | Propose a Google Docs change for approval. For editing, read the document first, preserve its tabs and formatting, and supply required_revision_id. requests sup |
| `gdocs_copy_document` | gdocs_copy_document | `document_id`: any<br>`title`: any<br>`folder_id`: any | Low | Propose a Google Docs change for approval. For editing, read the document first, preserve its tabs and formatting, and supply required_revision_id. requests sup |
| `gdocs_create_document` | gdocs_create_document | `title`: any<br>`text`: string | Low | Propose a Google Docs change for approval. For editing, read the document first, preserve its tabs and formatting, and supply required_revision_id. requests sup |
| `gdocs_get_document` | gdocs_get_document | `document_id`: any | Low | Read native Google Docs structure, all tabs, text, tables, styles, images and revisionId. Use gdrive_list_files to discover documents. |
| `gdocs_read_text` | gdocs_read_text | `document_id`: any<br>`offset`: number<br>`max_characters`: number | Low | Read Google Docs exported text through Drive, even when the native Docs API is disabled. Reports truncation and next_offset; continue until next_offset is null. |
| `gdocs_replace_text` | gdocs_replace_text | `document_id`: any<br>`required_revision_id`: any<br>`find`: string<br>`replace`: string<br>`match_case`: boolean<br>`tab_ids`: array | Low | Propose a Google Docs change for approval. For editing, read the document first, preserve its tabs and formatting, and supply required_revision_id. requests sup |
| `gdocs_trash_document` | gdocs_trash_document | `document_id`: any | Low | Propose a Google Docs change for approval. For editing, read the document first, preserve its tabs and formatting, and supply required_revision_id. requests sup |
| `gdocs_update_document` | gdocs_update_document | `document_id`: any<br>`required_revision_id`: any<br>`requests`: array | Low | Propose a Google Docs change for approval. For editing, read the document first, preserve its tabs and formatting, and supply required_revision_id. requests sup |
| `gdrive_create_file` | Create Google Drive File | `name`: string<br>`content`: string<br>`folder_id`: string<br>`mime_type`: string | Medium | Create a new text file in Google Drive. |
| `gdrive_list_files` | List Google Drive Files | `query`: string<br>`order_by`: string<br>`folder_id`: string<br>`page_token`: string<br>`max_results`: number | Low | List files in Google Drive, optionally filtered by name or folder. Sort with order_by (e.g. 'modifiedTime desc' for most recent first) — never put ordering insi |
| `gdrive_read_file` | Read Google Drive File | `file_id`: string<br>`export_mime`: string | Low | Read the text content of a Google Drive file (Docs, Sheets exported as text, or plain text files). |
| `gmail_create_draft` | gmail_create_draft | `to`: array<br>`cc`: array<br>`bcc`: array<br>`subject`: any<br>`body`: string<br>`body_format`: enum<br>`attachments`: array<br>`thread_id`: any<br>`in_reply_to`: any | Medium | Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), sta |
| `gmail_create_label` | gmail_create_label | `name`: any | Medium | Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), sta |
| `gmail_delete_draft` | gmail_delete_draft | `draft_id`: any | Medium | Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), sta |
| `gmail_delete_label` | gmail_delete_label | `label_id`: any | Medium | Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), sta |
| `gmail_get_attachment` | gmail_get_attachment | `message_id`: any<br>`attachment_id`: any | Low | Fetch a Gmail attachment by message and attachment IDs. Returns base64url bytes and size; binary bytes are not extracted text. |
| `gmail_get_draft` | gmail_get_draft | `draft_id`: any | Low | Read a saved Gmail draft with decoded body and recipients. |
| `gmail_get_message` | gmail_get_message | `message_id`: any | Low | Read a Gmail message including decoded text, full MIME payload, headers, body and attachment IDs. |
| `gmail_get_profile` | Identify Connected Gmail Account | — | Low | Identify the connected Gmail account before reading a named mailbox. AgentMail is a separate inbox and must not substitute for Gmail. |
| `gmail_get_thread` | gmail_get_thread | `thread_id`: any | Low | Read every message in a Gmail thread including decoded bodies and Message-ID headers for replies. |
| `gmail_list_drafts` | gmail_list_drafts | `page_token`: string<br>`max_results`: number | Low | List saved Gmail drafts with pagination. |
| `gmail_list_labels` | gmail_list_labels | — | Low | List available Gmail labels and their IDs. |
| `gmail_list_messages` | gmail_list_messages | `query`: string<br>`page_token`: string<br>`max_results`: number | Low | Search or list Gmail messages with query syntax and pagination. Each result carries id, subject, sender, date and snippet (metadata is fetched for up to 10 hits |
| `gmail_list_threads` | gmail_list_threads | `query`: string<br>`page_token`: string<br>`max_results`: number | Low | List Gmail conversations with pagination and optional search. |
| `gmail_modify_message` | gmail_modify_message | `message_id`: any<br>`add_label_ids`: array<br>`remove_label_ids`: array | Medium | Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), sta |
| `gmail_modify_thread` | gmail_modify_thread | `thread_id`: any<br>`add_label_ids`: array<br>`remove_label_ids`: array | Medium | Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), sta |
| `gmail_reply` | gmail_reply | `to`: array<br>`cc`: array<br>`bcc`: array<br>`subject`: any<br>`body`: string<br>`body_format`: enum<br>`attachments`: array<br>`thread_id`: any<br>`in_reply_to`: any | Medium | Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), sta |
| `gmail_search` | Search Gmail | `query`: string<br>`mailbox`: string<br>`max_results`: number | Low | Search the connected Gmail mailbox, not AgentMail, using Gmail query syntax. For a requested account, pass mailbox to verify identity. Apply after/before date f |
| `gmail_send` | Send Gmail | `to`: string<br>`subject`: string<br>`body`: string<br>`cc`: string<br>`is_html`: boolean | Medium | Send an email via Gmail. |
| `gmail_send_draft` | gmail_send_draft | `draft_id`: any | Medium | Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), sta |
| `gmail_send_message` | gmail_send_message | `to`: array<br>`cc`: array<br>`bcc`: array<br>`subject`: any<br>`body`: string<br>`body_format`: enum<br>`attachments`: array<br>`thread_id`: any<br>`in_reply_to`: any | Medium | Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), sta |
| `gmail_trash_message` | gmail_trash_message | `message_id`: any | Medium | Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), sta |
| `gmail_untrash_message` | gmail_untrash_message | `message_id`: any | Medium | Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), sta |
| `gmail_update_draft` | gmail_update_draft | `draft_id`: any<br>`to`: array<br>`cc`: array<br>`bcc`: array<br>`subject`: any<br>`body`: string<br>`body_format`: enum<br>`attachments`: array<br>`thread_id`: any<br>`in_reply_to`: any | Medium | Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), sta |
| `gmail_update_label` | gmail_update_label | `label_id`: any<br>`name`: any | Medium | Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), sta |

## Governance

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `request_adversarial_consensus` | Request Adversarial Consensus | `action`: string<br>`payload`: object<br>`targetResource`: string<br>`mintToken`: boolean | Low | Executes tripartite adversarial deliberation (Lead Architect, Compliance Sentinel, Devil's Advocate) before high-blast operations and mints a cryptographic Atte |
| `request_governance_approval` | Request Governance Action Approval | `actionKey`: string<br>`actionTitle`: string<br>`riskTier`: enum<br>`requestedBy`: string<br>`blastRadius`: object<br>`executionPayload`: object<br>`requiresDualSignOff`: boolean | Low | Shows a high-stakes action to the room for human review, with its blast radius. A sign-off is posted to the room as a message; it is not recorded as an approval and nothing executes the action. |
| `verify_action_attestation` | Verify Action Attestation | `token`: any<br>`expectedAction`: string<br>`expectedPayload`: object | Low | Verifies the cryptographic HMAC-SHA256 signature, expiry, and payload integrity of an AttestationToken. |

## HubSpot

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `hubspot_create_contact` | Create HubSpot Contact | `email`: string<br>`firstname`: string<br>`lastname`: string<br>`company`: string<br>`phone`: string<br>`lifecyclestage`: enum | Medium | Create a new contact in HubSpot CRM. |
| `hubspot_create_deal` | Create HubSpot Deal | `dealname`: string<br>`amount`: number<br>`dealstage`: string<br>`closedate`: string<br>`contact_id`: string | Medium | Create a new deal in HubSpot CRM pipeline. |
| `hubspot_log_activity` | Log HubSpot Activity | `body`: string<br>`contact_id`: string<br>`deal_id`: string | Low | Log a note or activity against a HubSpot contact or deal. |
| `hubspot_search_contacts` | Search HubSpot Contacts | `query`: string<br>`limit`: number | Low | Search HubSpot contacts by email, name, or company. |
| `hubspot_search_deals` | Search HubSpot Deals | `query`: string<br>`dealstage`: string<br>`limit`: number | Low | Search HubSpot deals by name or pipeline stage. |
| `hubspot_update_deal` | Update HubSpot Deal | `deal_id`: string<br>`dealstage`: string<br>`amount`: number<br>`closedate`: string | Medium | Update a HubSpot deal's stage, amount, or close date. |

## Human Input

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `list_hil_forms` | List Human Input Forms | — | Low | List the human-input forms already available in this organization. Check here before creating a new one — reusing an existing form keeps the library from fillin |
| `request_human_input` | Request Human Input | `name`: string<br>`fields`: array | Low | Put a form in front of a person when you need information only they can give — an approval, a value you must not guess, or a choice between options. Use this in |

## Instant Apps

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `assemble_instant_app` | Assemble Instant App | — | High | Compose MULTIPLE pre-built UI blocks into a single instant-app surface rendered live in the chat (no build/deploy). Use this when a task needs several blocks to |
| `list_instant_app_components` | List Instant App Components | `query`: string<br>`limit`: number | High | List the pre-built UI blocks that can be rendered live in the chat as an 'instant app' (no build/deploy). Returns each block's name, module, category, KIND (inp |
| `render_instant_app` | Render Instant App | — | Low | Render a single pre-built UI block LIVE in the chat as an 'instant app' — an ephemeral, no-build surface to help with the current task. ALWAYS pick the `compone |

## Integrations

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `add_jira_comment` | Add Jira Comment | `issueKey`: string<br>`comment`: string | Medium | Add a comment to an existing Jira issue. |
| `connect_platform` | Request a Platform Connection | `platform`: enum<br>`reason`: string | Low | Ask a person to connect an external platform — Gmail, Google Drive/Docs, Google Workspace, Microsoft 365, Jira — to this project space. Call it when a needed in |
| `create_jira_issue` | Create Jira Issue | `projectKey`: string<br>`summary`: string<br>`issueType`: string<br>`description`: string<br>`assignee`: string<br>`priority`: string<br>`labels`: array | Medium | Create a new Jira issue with summary, type, and optional fields. |
| `get_agentmail_thread` | Get AgentMail Thread | `threadId`: string | Low | Retrieve all messages in a specific AgentMail thread. |
| `get_saas_connector_schema` | Get Connector Schema | `platform`: string<br>`projectKey`: string | Low | Get metadata schema (field definitions) for a SaaS platform. |
| `get_servicenow_schema` | Get ServiceNow Table Schema | `tableName`: string | Low | Read the field definitions of a ServiceNow table (incident, change_request, sc_task, …) from sys_dictionary. Use when asked what fields a ServiceNow table has,  |
| `list_agentmail_threads` | List AgentMail Threads | `limit`: number | Low | List recent conversation threads from the AgentMail inbox. |
| `list_confluence_spaces` | List Confluence Spaces | — | Low | List the Confluence spaces available on the connected site, so one can be bound to this project. Use when asked which spaces exist, or before binding a space. |
| `list_jira_projects` | List Jira Projects | — | Low | List the Jira projects available on the connected site, so one can be bound to this project. Use when asked which Jira projects exist, or before binding one. |
| `list_saas_adapters` | List SaaS Adapters | — | Low | List the SaaS adapters available to this project — Jira projects, Confluence spaces, Slack, GitHub — with their connection status, sync cadence, and whether a s |
| `list_saas_connectors` | List SaaS Connectors | — | Low | List all configured SaaS connectors and their current status. |
| `propose_adapter_binding` | Propose Binding a SaaS Resource to This Project | `resourceKind`: enum<br>`resourceKey`: string<br>`resourceName`: string<br>`resourceType`: string<br>`externalId`: string<br>`webUrl`: string<br>`reason`: string | Low | Propose binding a Confluence space or Jira project to this project space. Call list_confluence_spaces or list_jira_projects first and propose only a key that ex |
| `propose_outbound_message` | Draft Outbound Message for Review | `channel`: enum<br>`to`: any<br>`from`: string<br>`subject`: string<br>`body`: string<br>`cc`: any<br>`workspace`: string<br>`threadTs`: string<br>`thread`: string<br>`sendTool`: string<br>`messageId`: string<br>`trigger`: string<br>`sensitivity`: enum<br>`escalate`: boolean<br>`reason`: string | Medium | Draft an outbound email or Slack message and show it as a confirmation card the human can send or discard. Prefer this over a direct send whenever context makes |
| `reply_agentmail` | reply_agentmail | `messageId`: string<br>`text`: string<br>`html`: string<br>`cc`: array<br>`bcc`: array<br>`replyAll`: boolean<br>`clientId`: string | Low | Reply to a specific AgentMail message. This ensures the message is correctly threaded. |
| `send_agentmail` | Send AgentMail Email | `to`: any<br>`subject`: string<br>`body`: string<br>`message`: string<br>`text`: string<br>`html`: string<br>`threadId`: string<br>`cc`: any<br>`bcc`: any<br>`labels`: array<br>`clientId`: string | Medium | Send an outbound email from the configured AgentMail inbox. Supports rich styling, CC/BCC, and labels. |
| `send_email` | Send Outbound Email | `to`: any<br>`subject`: string<br>`body`: string<br>`message`: string<br>`text`: string<br>`html`: string<br>`cc`: any<br>`bcc`: any | Medium | Send an outbound email via AgentMail. Specify recipient (to), subject, and body/text. |
| `sync_saas_connector` | Sync SaaS Data | `platform`: string<br>`syncType`: string | Medium | Trigger a manual data synchronization for a specific SaaS platform. |
| `transition_jira_issue` | Transition Jira Issue | `issueKey`: string<br>`status`: string | Low | Change the status of a Jira issue (e.g., move to 'Done'). |
| `update_jira_issue` | Update Jira Issue | `issueKey`: string<br>`summary`: string<br>`description`: string<br>`priority`: string<br>`assignee`: string<br>`labels`: array | Medium | Update fields of an existing Jira issue (summary, description, priority, etc.). |
| `update_saas_sync_config` | Update Sync Config | `platform`: string<br>`config`: object | Medium | Update synchronization configuration for a SaaS connector. |

## Knowledge

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `attach_url` | Attach a File From a URL | `url`: string<br>`fileName`: string | Low | Fetch a file from a URL the user supplied (PDF, CSV, JSON, image, or page) and attach it to this room, where it is parsed and indexed. Use this whenever the use |
| `get_attachment_text` | Get Attached File Text Content | `attachmentId`: number<br>`fileName`: string<br>`maxChars`: number<br>`offset`: number | Low | Retrieve the full extracted text content of an attached file (PDF, DOCX, Markdown, CSV, etc.) to read requirements, form fields, schemas, or specifications. Pas |
| `list_attachments` | List Attached Files | `thisRoomOnly`: boolean | Low | List the files attached to this project, with whether each one has been read and indexed. Use this to see what is available before searching, or to explain why  |
| `list_saved_queries` | List Saved Queries | — | Low | Lists the saved knowledge-graph queries available to this organization, with their names and descriptions. Call this before run_saved_query so you use a query t |
| `propose_attachment_promotion` | Propose Filing an Attachment in the Knowledge Base | `attachmentId`: number<br>`title`: string<br>`reason`: string | Low | Propose filing an attached file into this project's knowledge base, so it is retrievable beyond this room. Call list_attachments first and propose only an attac |
| `propose_knowledge_ingestion` | Propose Scoped Data Ingestion & Entity Enrichment | `sourceName`: string<br>`timeframeOrFilter`: string<br>`reason`: string | Low | Proposes running a targeted 1-time external ingestion job (e.g. Jira, Zendesk, PDF, or Datasets) to extract entity triples and enrich the room's Knowledge Graph |
| `run_saved_query` | Run Saved Query | `query`: any<br>`title`: string | Low | Runs a saved knowledge-graph query by name or id and renders the results as a table. Use this whenever asked about data a saved query covers, instead of describ |
| `search_attachments` | Search Attached Files | `query`: string<br>`limit`: number<br>`thisRoomOnly`: boolean | Low | Search the files attached to this project for passages relevant to a question. Use this before answering anything about an uploaded document — it returns the ac |

## Knowledge Graph

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `create_entity` | Create Entity | `name`: string<br>`entityType`: string<br>`externalId`: string<br>`properties`: object | Medium | Create a new entity in the knowledge graph. Requires admin permissions. |
| `create_relationship` | Create Relationship | `sourceEntityName`: string<br>`targetEntityName`: string<br>`relationType`: string | Medium | Create a relationship between two entities. Requires admin permissions. |
| `explore_relationships` | Explore Relationships | `entityName`: string<br>`depth`: number<br>`direction`: enum<br>`relations`: array | Low | Traverse the knowledge graph from a starting entity to explore its connections. Use this to 'walk' the graph deeply. |
| `get_concept_governance` | Get Concept Governance | `conceptName`: string | Low | Get governance policies and rules associated with a specific high-level concept. |
| `get_concept_smes` | Get Concept SMEs | `conceptName`: string | Low | Get the Subject Matter Experts (SMEs) for a specific high-level concept. |
| `get_concept_topics` | Get Concept Topics | `conceptName`: string | Low | Get all granular topics associated with a specific high-level concept. |
| `get_documents_for_entity` | Get Entity Docs | `entityId`: number<br>`entityName`: string | Low | Find documents and technical specifications linked to a specific entity in the knowledge graph. |
| `get_entity_details` | Entity Details | `entityId`: number | Low | Get full details, properties, and linked documents for a specific entity by its ID. |
| `get_entity_impact` | Analyze Impact | `entityName`: string<br>`entityType`: string<br>`direction`: enum | Low | Analyze what entities depend on a specific entity (impact analysis). |
| `get_graph_statistics` | Get Graph Stats | — | Low | Get statistics about the knowledge graph (entity counts, relationship counts). |
| `list_concepts` | List Concepts | — | Low | List all high-level semantic concepts defined in the knowledge graph. These group granular topics together. |
| `search_knowledge_graph` | Search Graph | `query`: string<br>`entityType`: string<br>`includeRelationships`: boolean<br>`limit`: number | Low | Search for entities in the knowledge graph by name or type. |
| `suggest_schema` | Suggest Schema | `domainDescription`: string | Low | Use AI to suggest a knowledge graph schema for a given domain. Requires admin permissions. |

## Knowledge Graph Calculations

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `create_calculation_node` | Create Calculation Node | `nodeId`: number<br>`operation`: enum<br>`formula`: string<br>`inputReferences`: array<br>`outputUnit`: string | Low | Creates a Neuro-Symbolic calculation node on a target Knowledge Graph node (supports FORMULA, MOVING_AVERAGE, YEAR_OVER_YEAR, MONTE_CARLO_SIMULATION, BAYESIAN_I |
| `execute_calculation_node` | Execute Calculation Node | `calculationId`: number<br>`forceRecalculate`: boolean | Low | Executes a calculation node and returns the evaluated result and timing metrics. |
| `list_calculation_nodes` | List Calculation Nodes | `status`: string<br>`operation`: string<br>`limit`: number | Low | Lists calculation nodes for the organization with optional status and operation filters. |

## Knowledge Management

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `generate_diagnostic_questions` | Generate Diagnostic Questions | `assetType`: string<br>`problemDescription`: string | Low | Dynamically generate highly specific troubleshooting questions for a physical asset based on its type and reported problem. |
| `get_document_content` | Get Document Content | `documentId`: number | Low | Get the full content of a specific document. |
| `get_document_template` | Get Document Template | `templateId`: number<br>`templateName`: string | Low | Get the full content of a document template. Use this when a user asks for an example report, test plan, or any templated document format. |
| `import_huggingface_dataset` | Import HuggingFace Dataset | `dataset`: string<br>`config`: string<br>`split`: string<br>`inputColumn`: string<br>`outputColumn`: string<br>`limit`: number | Low | Import a dataset from the Hugging Face Hub directly into Oddjob's fine-tuning system. |
| `learn_lesson` | Learn Lesson | `missionId`: number<br>`content`: string | Medium | Persist a 'Lesson Learned' or strategic insight discovered during a mission. Use this to update the Agency Intelligence base. |
| `list_document_templates` | List Document Templates | `category`: string<br>`type`: string | Low | List all available document templates for the organization. Use this to show users what templates they can use. |
| `list_documents` | List Documents | `search`: string<br>`limit`: number | Low | List all documents in the knowledge base. |
| `publish_wiki_article` | Publish Wiki Article | `title`: string<br>`content`: string<br>`category`: string<br>`missionId`: number<br>`topicNames`: array | Medium | Publish a formal, structured article to the Organizational Memory Wiki. Use this for substantial research findings, technical guides, or operational truth disco |
| `query_knowledge_subgraph` | Query Knowledge Graph Subgraph & Summarize | `entityName`: string<br>`maxHops`: number<br>`limit`: number<br>`includeProperties`: boolean | Low | Performs a multi-hop subgraph expansion and topological summarization around a named entity or concept in the Knowledge Graph. Returns direct entity properties, |
| `search_unified_knowledge` | Search Unified Knowledge | `query`: string<br>`filter_source`: enum<br>`limit`: number<br>`before`: string<br>`after`: string<br>`since`: string<br>`updated_before`: string<br>`updated_after`: string | Low | Search the Unified Knowledge Base (Operational Truth) for information. This includes documentation (Confluence), structured data (Datasets), and entity relation |

## Linear

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `linear_add_comment` | Add Linear Comment | `identifier`: string<br>`body`: string | Medium | Add a comment to a Linear issue. |
| `linear_create_issue` | Create Linear Issue | `team_key`: string<br>`title`: string<br>`description`: string<br>`priority`: number<br>`assignee_email`: string | Medium | Create a new Linear issue in a team. |
| `linear_get_issue` | Get Linear Issue | `identifier`: string | Low | Get full details of a Linear issue by its identifier (e.g. ENG-123). |
| `linear_search_issues` | Search Linear Issues | `query`: string<br>`team_key`: string<br>`state`: string<br>`assignee_email`: string<br>`limit`: number | Low | Search for Linear issues by title, status, assignee, or team. |
| `linear_update_issue` | Update Linear Issue | `identifier`: string<br>`title`: string<br>`description`: string<br>`state_name`: string<br>`priority`: number | Medium | Update a Linear issue's title, description, state, or priority. |

## Memory

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `remember` | Remember About User | `content`: string<br>`kind`: enum | Medium | Persist a DURABLE fact or preference about the CURRENT user for future conversations (e.g. 'prefers concise, bullet-point answers', 'is working on the Q3 launch |

## Microsoft 365

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `calendar_create_event` | Create Calendar Event | `subject`: string<br>`body`: string<br>`startDateTime`: string<br>`endDateTime`: string<br>`attendees`: array | Medium | Create a new calendar event in Microsoft 365 / Outlook. |
| `calendar_list_events` | List Calendar Events | `startDateTime`: string<br>`top`: number | Low | List upcoming calendar events from Microsoft 365 / Outlook. |
| `m365_list_documents` | Find Microsoft documents | `drive_id`: string<br>`query`: string<br>`folder_id`: string<br>`skip_token`: string<br>`max_results`: number | Low | Find OneDrive or SharePoint drive files. Omit drive_id for personal OneDrive. Results include drive identifiers needed to read selected documents. |
| `m365_list_drives` | List Microsoft document libraries | `site_id`: string | Low | List OneDrive drives, or SharePoint document libraries for a site_id. Use returned drive IDs to find and read documents. |
| `m365_read_document` | Read Microsoft document | `document_id`: string<br>`drive_id`: string<br>`offset`: number<br>`max_characters`: number | Medium | Read Word DOCX or text documents from OneDrive/SharePoint in character pages. Reuses one download per turn. Continue with next_offset until null; report partial |
| `m365_search_sites` | Find SharePoint sites | `query`: string | Low | Find accessible SharePoint sites by name. Use a returned site ID with m365_list_drives to find document libraries. |
| `outlook_send_email` | Send Outlook Email | `to`: array<br>`subject`: string<br>`body`: string<br>`isHtml`: boolean | Medium | Send an email via Microsoft 365 / Outlook. |
| `sharepoint_list_files` | List SharePoint Files | `siteId`: string<br>`folderPath`: string | Low | List files in a SharePoint site drive folder. |
| `teams_list_channels` | List Teams Channels | `teamId`: string | Low | List all channels in a Microsoft Teams team. |
| `teams_list_teams` | List Teams | — | Low | List all Microsoft Teams the authenticated user belongs to. |
| `teams_post_message` | Post Teams Message | `teamId`: string<br>`channelId`: string<br>`message`: string<br>`isHtml`: boolean<br>`subject`: string | Low | Post a message to a Microsoft Teams channel. |

## Mission

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `dispatch_autonomous_mission` | Dispatch Autonomous Mission | `manifest`: any<br>`tokenBudget`: number<br>`missionId`: string | Low | Dispatches a multi-step TaskManifest DAG to the background worker mesh with checkpoint recovery and budget governance. |
| `get_autonomous_mission_status` | Get Autonomous Mission Status | `sessionId`: string<br>`missionId`: string | Low | Checks real-time progress, latest verified checkpoint, and token burn rate for an autonomous mission. |
| `resume_autonomous_mission` | Resume Autonomous Mission | `missionId`: string<br>`sessionId`: string<br>`manifest`: any<br>`additionalTokenBudget`: number | Low | Resumes a paused, crashed, or budget-paused mission from its latest verified checkpoint. |

## Mission Control

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `apply_recovery_decision` | Apply Mission Recovery Decision | `missionRunId`: number<br>`strategy`: enum<br>`customInstructions`: string | Medium | Executes a recovery strategy (retry, replan, relax, stop) on an active mission run after a human decision. |
| `list_mission_runs` | List Mission Runs | `missionId`: number<br>`limit`: number | Low | List historical and active runs for a specific mission. Use this to identify why a mission might be blocked or failing. |
| `list_missions` | List Missions | `limit`: number | Low | List all missions in the current organization. Provides IDs, names, and current status. |
| `wave_reflection_synthesis` | Wave Reflection Synthesis | `reflection`: string<br>`status`: enum | Low | Synthesizes feedback from the Critic and constraints from the Developer to finalize the current wave and prepare for the next. Required at the end of every Roll |

## Monitoring

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `monitoring_get_incidents` | Get Incidents | `status`: enum<br>`limit`: number | Low | Get current incidents from PagerDuty. |
| `monitoring_list_alerts` | List Active Monitors | `tags`: array<br>`limit`: number | Low | List active monitors/alerts from Datadog. |
| `monitoring_list_dashboards` | List Datadog Dashboards | — | Low | List available Datadog dashboards. |
| `monitoring_query_metrics` | Query Metrics | `query`: string<br>`from`: string<br>`to`: string | Low | Query time-series metrics from Datadog. Returns series data for the specified query and time range. |
| `monitoring_resolve_incident` | Resolve Incident | `incidentId`: string | Low | Resolve a PagerDuty incident by ID. |
| `monitoring_trigger_alert` | Trigger PagerDuty Alert | `routingKey`: string<br>`summary`: string<br>`severity`: enum<br>`details`: string | Medium | Trigger a new alert/event in PagerDuty via an integration routing key. |

## Multimodal / Vision

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `vision_analyze` | Analyze Image | `image`: string<br>`prompt`: string | Low | Analyze an image using Google Gemini Vision. Accepts a public URL or base64 data URI. Returns a text description or answer to your prompt. |
| `vision_describe_screenshot` | Describe Screenshot | `image`: string<br>`focus`: string | Low | Describe the UI state in a screenshot — useful for computer-use workflows. Identifies visible elements, text, and layout. |
| `vision_extract_text` | Extract Text from Image (OCR) | `image`: string | Low | Extract all text from an image using Gemini Vision (OCR). Returns the raw text content found in the image. |

## Notion

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `notion_create_page` | Create Notion Page | `parent_id`: string<br>`parent_type`: enum<br>`title`: string<br>`content`: string | Medium | Create a new page in a Notion database or as a child of another page. |
| `notion_get_page` | Get Notion Page | `page_id`: string | Low | Retrieve the content of a Notion page by its ID. |
| `notion_query_database` | Query Notion Database | `database_id`: string<br>`filter`: object<br>`page_size`: number | Low | Query rows from a Notion database with optional filters. |
| `notion_search` | Search Notion | `query`: string<br>`filter_type`: enum | Low | Search pages and databases in Notion by keyword. |
| `notion_update_page` | Update Notion Page | `page_id`: string<br>`title`: string<br>`archived`: boolean | Medium | Update the title or properties of an existing Notion page. |

## Observability

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `get_cost_analysis` | Get Cost Analysis | `days`: number | Low | Get AI cost analytics including total spend, daily trends, cost by model, and top spending pipelines. |
| `get_health_dashboard` | Get Health Dashboard | — | Low | Get comprehensive system health including active schedules, failed jobs, alerts, and pipeline statistics. |
| `list_alerts` | List Alerts | `severity`: enum<br>`includeAcknowledged`: boolean<br>`limit`: number | Low | List active alerts in the system, optionally filtered by severity. |

## Ontology

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `ontology_define_link_type` | Declare an Ontology Relationship | — | Low | Declare a governed relationship between two Object Types. Derived links follow an existing source property; materialized links store explicit edges between mate |
| `ontology_execute_action` | Execute Ontology Action | `actionName`: string<br>`parameters`: object | Medium | Execute a pre-validated business Action on an Ontology Object instance. Write actions require approval. |
| `ontology_get_object` | Get Ontology Object | `objectType`: string<br>`id`: any | Low | Retrieve a specific instance of a business Object by its ID. |
| `ontology_link_objects` | Link Ontology Objects | `sourceType`: string<br>`linkName`: string<br>`sourceId`: any<br>`targetId`: any | Medium | Create a governed stored edge between two materialized Ontology Objects. Re-linking the same pair is idempotent. |
| `ontology_list_link_types` | List Ontology Link Types | `objectType`: string | Low | Discover the declared relationships between this organization's Object Types — what you can traverse, and under which name in each direction (e.g. 'App Deployme |
| `ontology_list_object_types` | List Ontology Object Types | — | Low | Discover the business Object Types available in this organization's Ontology. |
| `ontology_list_objects` | List Ontology Objects | `objectType`: string<br>`limit`: number | Low | List instances of a specific business Object Type in the Palantir-style Ontology layer. |
| `ontology_traverse_link` | Traverse an Ontology Relationship | `objectType`: string<br>`id`: any<br>`link`: string<br>`limit`: number | High | Follow a declared relationship from one object to the objects on its other end — 'which App does this deployment deploy?', or from the far end, 'which deploymen |
| `ontology_unlink_objects` | Unlink Ontology Objects | `sourceType`: string<br>`linkName`: string<br>`sourceId`: any<br>`targetId`: any | Medium | Remove a governed stored edge between two materialized Ontology Objects. Removing a missing edge is idempotent. |

## Operations

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `approve_cycle` | Approve & Launch Cycle | `cycleId`: number | Medium | Approve a staged (pending_approval) operational cycle and launch its mission fleet — the same as clicking 'Approve & Launch' on the cycle page. Requires org-adm |
| `check_error_budget_safety` | check_error_budget_safety | `serviceName`: string<br>`minRequiredBudgetPercent`: number | Low | Validates that remaining service error budgets and availability SLOs permit running a chaos experiment safely. |
| `generate_chaos_post_mortem` | generate_chaos_post_mortem | `injectionResult`: any<br>`scenarioDescription`: string | Low | Synthesizes drill telemetry into an automated SRE post-mortem report with timeline and preventative action items. |
| `list_pending_cycles` | List Pending Cycles | `limit`: number | Low | List operational cycles that are staged and awaiting human approval before their mission fleet can launch. Use this to find the cycle id/name the user is referr |
| `mount_project_studio` | Mount Project Studio | `cycleId`: number<br>`cycleName`: string<br>`title`: string<br>`projectTitle`: string<br>`objective`: string<br>`waves`: array<br>`budgetLimitUsd`: number<br>`tokenLimit`: number<br>`targetSlaDays`: number<br>`maxParallelMissions`: number | Low | Mounts Project Studio in the side rail beside the CREW conversation. Pass cycleId to reopen a saved cycle's wave plan, or pass the plan (projectTitle, objective |
| `simulate_network_latency` | simulate_network_latency | `targetService`: string<br>`addedLatencyMs`: number<br>`durationSeconds`: number | Low | Simulates controlled network latency on an upstream service to test timeout handling and circuit breakers. |
| `simulate_service_failure` | simulate_service_failure | `targetService`: string<br>`failureMode`: enum | Low | Simulates an upstream dependency failure (503, connection refused, or timeout) to verify graceful fallback. |

## Pipeline Orchestration

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `add_pipeline_step` | Add Pipeline Step | `pipelineId`: number<br>`jobId`: number<br>`moduleType`: enum<br>`order`: number<br>`outputName`: string<br>`runOnCondition`: string<br>`onFailureAction`: enum<br>`waitDurationSeconds`: number<br>`decisionNodeConfig`: object<br>`iteratorConfig`: object | Medium | Add a step to an existing pipeline. Step can be a job, decision node, or iterator. Requires admin permissions. |
| `create_pipeline` | Create Pipeline | `name`: string<br>`description`: string<br>`triggerType`: enum<br>`isActive`: boolean<br>`steps`: array | Medium | Create a new automation pipeline. Requires admin permissions. Can include steps with jobs, decisions, and iterators. |
| `create_schedule` | Create Schedule | `name`: string<br>`description`: string<br>`pattern`: number<br>`patternString`: object<br>`patternLabel`: string<br>`timezone`: string<br>`isActive`: boolean | Medium | Create a new schedule pattern. Requires admin. Patterns: 1=hourly, 2=daily, 3=weekly, 4=cron. Use patternString for timing config. |
| `create_scheduled_job` | Create Scheduled Job | `name`: string<br>`jobId`: number<br>`pipelineId`: number<br>`scheduleId`: number<br>`triggerType`: enum<br>`priority`: number<br>`isActive`: boolean<br>`alertOnFailure`: boolean<br>`maxRetries`: number<br>`parameterValues`: object | Medium | Schedule a job or pipeline to run automatically. Requires admin. Provide jobId OR pipelineId, plus scheduleId for scheduling. |
| `delegate_to_pipeline` | Delegate to Pipeline | `pipelineId`: number<br>`pipelineName`: string<br>`inputData`: object<br>`reason`: string | Low | Delegate a sub-task to a specific pipeline. This creates a child execution linked to the current execution. Returns an executionId. |
| `delete_pipeline` | Delete Pipeline | `pipelineId`: number<br>`userConfirmed`: boolean | High | Delete a pipeline. Requires admin permissions. IMPORTANT: You MUST ask user to confirm before executing this delete. |
| `delete_pipeline_step` | Delete Pipeline Step | `stepId`: number<br>`userConfirmed`: boolean | High | Remove a step from a pipeline. Requires admin permissions. IMPORTANT: You MUST ask user to confirm before executing this delete. |
| `delete_schedule` | Delete Schedule | `scheduleId`: number<br>`userConfirmed`: boolean | High | Delete a schedule. Requires admin. IMPORTANT: You MUST ask user to confirm before executing this delete. |
| `delete_scheduled_job` | Delete Scheduled Job | `scheduledJobId`: number<br>`userConfirmed`: boolean | High | Delete a scheduled job. Requires admin. IMPORTANT: You MUST ask user to confirm before executing this delete. |
| `get_pipeline_details` | Get Pipeline Details | `pipelineId`: number<br>`pipelineName`: string<br>`includeExecutionHistory`: boolean | Low | Get detailed information about a specific pipeline. |
| `get_pipeline_status` | Get Pipeline Status | `executionId`: number | Low | Check the status and results of a specific pipeline execution. Use this to poll for completion after triggering a pipeline. |
| `get_schedule_details` | Get Schedule Details | `scheduleId`: number<br>`scheduleName`: string | Low | Get details of a specific schedule including its pattern configuration. |
| `get_scheduled_job_details` | Get Scheduled Job Details | `scheduledJobId`: number<br>`scheduledJobName`: string | Low | Get detailed configuration of a scheduled job including schedule, alerts, and retry settings. |
| `get_template_details` | Get Template Details | `templateId`: number<br>`templateName`: string | Low | Get the configuration details of a specific template. |
| `get_upcoming_scheduled_runs` | Get Upcoming Runs | `limit`: number | Low | Get a list of upcoming scheduled executions. Calculates next run times for all active scheduled jobs/pipelines. |
| `list_pipelines` | List Pipelines | `search`: string<br>`limit`: number | Low | List available pipelines, optionally filtering by name. A pipeline is the same thing the Oddjob UI calls a WORKSTREAM — use this tool for any question about wor |
| `list_recent_executions` | List Recent Executions | `limit`: number<br>`status`: enum<br>`pipelineId`: number | Low | List recent pipeline executions, optionally filtered by status. A pipeline execution is a run of what the Oddjob UI calls a WORKSTREAM — use this with status='R |
| `list_scheduled_jobs` | List Scheduled Jobs | `activeOnly`: boolean<br>`triggerType`: enum | Low | List all scheduled jobs/pipelines. Shows which jobs or pipelines are scheduled and their trigger type. |
| `list_schedules` | List Schedules | `activeOnly`: boolean | Low | List all schedule patterns in the organization. Schedules define WHEN jobs/pipelines run (hourly, daily, weekly, cron). |
| `list_templates` | List Templates | `search`: string<br>`category`: string<br>`limit`: number | Low | List available pipeline templates. Use this to recommend templates to the user. |
| `resolve_intent_to_pipeline` | Resolve Intent to Pipeline | `intent`: string | Medium | Map a user's natural language intent (e.g. 'Run JIRA analysis') to a pipeline. Use before trigger_pipeline when the user describes what they want to run. |
| `run_pipeline` | Run Pipeline | `pipelineId`: number<br>`pipelineName`: string<br>`inputData`: object<br>`dryRun`: boolean | Medium | Trigger execution of a pipeline. Requires admin permissions. Returns executionId. You should poll get_pipeline_status for final results. |
| `show_pipeline_input_form` | Show Pipeline Input Form | `pipelineId`: any<br>`pipelineName`: string<br>`fields`: array | Low | RENDERS A UI FORM in the chat when a pipeline requires input (like VIN, ID, etc.). `pipelineId` must be a real pipeline id or an exact existing name — if you ar |
| `trigger_pipeline` | Trigger Pipeline | `nonce`: string<br>`pipelineId`: any<br>`inputData`: object | Medium | Trigger a new execution of a pipeline with optional input data. Returns an executionId. After triggering, poll 'get_pipeline_status' until completed. IMPORTANT: |
| `update_pipeline` | Update Pipeline | `pipelineId`: number<br>`name`: string<br>`description`: string<br>`isActive`: boolean<br>`triggerType`: enum | Medium | Update an existing pipeline. Requires admin permissions. |
| `update_pipeline_step` | Update Pipeline Step | `stepId`: number<br>`jobId`: number<br>`order`: number<br>`outputName`: string<br>`runOnCondition`: string<br>`onFailureAction`: enum<br>`waitDurationSeconds`: number<br>`decisionNodeConfig`: object | Medium | Update a pipeline step. Requires admin permissions. |
| `update_schedule` | Update Schedule | `scheduleId`: number<br>`name`: string<br>`description`: string<br>`pattern`: number<br>`patternString`: object<br>`patternLabel`: string<br>`timezone`: string<br>`isActive`: boolean | Medium | Update a schedule pattern. Requires admin permissions. |
| `update_scheduled_job` | Update Scheduled Job | `scheduledJobId`: number<br>`name`: string<br>`scheduleId`: number<br>`triggerType`: enum<br>`priority`: number<br>`isActive`: boolean<br>`alertOnFailure`: boolean<br>`maxRetries`: number<br>`parameterValues`: object | Medium | Update a scheduled job configuration. Requires admin permissions. |

## Platform & Specs

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `get_platform_feature_spec` | Get Platform Feature Spec | `featureId`: string | Low | Fetch the full specification for one platform feature, or the aggregate 'api', 'ui' or 'capability' spec. |
| `get_platform_pattern` | Get Platform Pattern | `id`: string | Low | Retrieve one Oddjob operational pattern by ID. Returns the structured agent execution contract and token-optimized agent markdown. |
| `get_system_spec` | Get System Spec | `featureId`: string<br>`specType`: enum | Low | Retrieve the full markdown of one system documentation spec. Provide EITHER featureId for a backend domain module, OR specType 'api' / 'ui' / 'capability'. Pref |
| `list_platform_features` | List Platform Features | — | Low | Enumerate documented platform feature modules with their ids and versions. Use to discover a valid featureId for get_platform_feature_spec. |
| `list_platform_patterns` | List Platform Patterns | `audience`: enum<br>`category`: string | Low | List Oddjob's operational patterns, best-practice runbooks, and architectural standards. Filter by audience (AGENT_PRIMARY, HUMAN_PRIMARY, HYBRID, GOVERNANCE) o |
| `list_system_specs` | List System Specs | `specType`: enum | Low | List Oddjob's auto-generated system documentation specs — every backend domain module plus the platform API, UI and capability specs — with each one's freshness |
| `read_internal_repo_doc` | Read Internal Repo Doc | `docPath`: string | Low | Read a markdown document from the repository's docs/ directory by relative path, e.g. 'specs/World_Model_Spec.md'. Reads are confined to docs/. |
| `search_platform_documentation` | Search Platform Documentation | `query`: string | Low | Search this platform's feature specs, API contracts, capability manifests and UI specs. Use before answering questions about internal architecture or platform c |
| `search_platform_patterns` | Search Platform Patterns | `query`: string<br>`audience`: enum | Low | Search the full text, tags, and structured execution contracts of Oddjob best practice operational patterns and runbooks. |
| `search_system_docs` | Search System Docs | `query`: string | Low | Search across the auto-generated system documentation specs (modules, API, UI). Prefer this over generic document search when you specifically want authoritativ |

## Prediction

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `estimate_trajectory` | Estimate a Trajectory | `features`: object<br>`horizonSeconds`: number<br>`confidenceThreshold`: number<br>`signalFeedId`: string<br>`eventFilter`: string<br>`signalLookbackHours`: number | Low | Computes a kinematic trajectory estimate from a feature vector: vessel velocity composed with wind leeway and current advection, an ETA from the remaining dista |
| `mount_prediction_studio` | Mount Prediction Studio | `modelId`: string<br>`modelName`: string<br>`streamId`: string<br>`view`: enum<br>`activeHorizon`: enum<br>`environmental`: object | Low | Mounts Prediction Studio in the side-rail beside the CREW conversation, allowing visual inspection of real-time inference, confidence envelopes (p10/p50/p90), d |
| `propose_prediction_job` | Draft a Prediction Job | `name`: string<br>`instruction`: string<br>`inputFeatures`: string<br>`modelId`: string<br>`horizonSeconds`: number<br>`confidenceThreshold`: number | Medium | Drafts a prediction_inference job and returns it as a card for a person to create. Writes nothing; the person presses Create. Use it when someone wants a trajec |

## Project Budget

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `get_project_spend` | Get Project Spend | `projectKey`: string | Low | Retrieves current spend, budget cap and remaining USD. Scoped to a Project Space when one is given or active in context; otherwise falls back to organization-wi |
| `set_project_budget_cap` | Set Project Budget Cap | `projectKey`: string<br>`budgetLimitUsd`: number | Low | Sets or updates the financial budget limit (USD) for a Project Space. |

## Rescue

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `geo_discovery` | Discover Nearby Helpers | `lat`: number<br>`lng`: number<br>`radiusKm`: number<br>`limit`: number | Low | Find qualified rescue helpers within a specific radius of a coordinate. |
| `geocoding` | Geocoding (Address <-> Lng/Lat) | `address`: string<br>`lat`: number<br>`lng`: number | Low | Convert a natural language address/landmark into Lng/Lat coordinates, or vice-versa (Reverse Geocoding). |
| `rescue_dispatch` | Initiate Rescue Dispatch | `serviceType`: string<br>`userLat`: number<br>`userLng`: number<br>`address`: string<br>`isDemoMode`: boolean | Medium | Trigger a formal rescue coordination flow. This creates a rescue session, initiates the mission, and starts the discovery/dispatch process. |
| `rescue_dispatch_action` | Execute Rescue Dispatch Stage | `action`: string<br>`stepCode`: string | Medium | Execute one deterministic, idempotent Service Dispatch pipeline stage against the protected app dataset. |

## Rich UI

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `publish_work_product` | Publish Room Work Product | `documentKey`: string<br>`title`: string<br>`content`: string<br>`changeSummary`: string<br>`sourceTurnId`: number | Medium | Create or revise a room work product: a brief, plan, specification, research report, or summary. Reuse the same documentKey for revisions of the same deliverabl |
| `render_app_catalog` | Render App Catalog | `title`: string<br>`description`: string<br>`items`: array | Low | Present MULTIPLE apps or workspaces as an interactive catalog grid in the assistant chat. ALWAYS use this instead of listing apps in prose when there are 2 or m |
| `render_app_surface` | Render App Surface | `title`: string<br>`description`: string<br>`source`: enum<br>`slug`: string<br>`href`: string<br>`mode`: enum<br>`actionLabel`: string<br>`blueprint`: string<br>`cycleSlug`: string<br>`cycleName`: string<br>`routePath`: string<br>`sourceAppId`: string<br>`sourceAppName`: string | Low | Present a published app or workspace to the user as an interactive app card in the assistant chat. Use this when the user's task is best handled inside a dedica |
| `render_carousel` | Render Carousel | — | Low | Render a swipeable card carousel in the assistant chat to present 2+ items the user browses one or a few at a time. Use this for products, document versions, ge |
| `render_chart` | Render Chart | `title`: string<br>`description`: string<br>`type`: enum<br>`data`: array<br>`xAxis`: string<br>`yAxis`: string<br>`colors`: array | Low | Render a data visualization chart in the assistant chat to display trends, comparisons, or analytics. Use this whenever you need to visualize data (e.g. sales t |
| `render_comparison` | Render Comparison | `title`: string<br>`description`: string<br>`items`: array<br>`criteria`: array | Low | Render a specialized side-by-side comparison view in the assistant chat for comparing 2-3 items. Use this whenever you need to compare features, products, or op |
| `render_gate_review` | Render Gate Review | `template`: enum<br>`title`: string<br>`summary`: string<br>`period`: string<br>`methodologyVersion`: string<br>`criteria`: array<br>`gates`: array<br>`actions`: array | Low | Present an evidence-backed professional review. Scores use 0–100; use null for missing data. Gate status is pass, fail, or unknown. This renders a recommendatio |
| `render_intake_form` | Render Intake Form | — | Low | Render an INTERACTIVE form in the assistant chat to collect input, build a live CALCULATOR, or render a LIVE DATA APP (e.g. weather forecast, currency converter |
| `render_list` | Render List | `title`: string<br>`description`: string<br>`type`: enum<br>`items`: array | Low | Render a structured list in the assistant chat to display items, tasks, features, or steps. Use this whenever you need to present information as a list (e.g. ta |
| `render_map` | Render Map | `title`: string<br>`description`: string<br>`markers`: array<br>`center`: object<br>`zoom`: number<br>`mapStyle`: enum<br>`route`: object | Low | Render an interactive geographic map in the assistant chat to display geographic locations, facilities, routes, or proximity results with marker pins. Use this  |
| `render_performance_scorecard` | Render Performance Scorecard | `template`: enum<br>`title`: string<br>`summary`: string<br>`period`: string<br>`methodologyVersion`: string<br>`criteria`: array<br>`gates`: array<br>`actions`: array | Low | Present an evidence-backed professional review. Scores use 0–100; use null for missing data. Gate status is pass, fail, or unknown. This renders a recommendatio |
| `render_progress` | Render Progress | `title`: string<br>`description`: string<br>`type`: enum<br>`value`: number<br>`total`: number<br>`status`: enum<br>`segments`: array<br>`steps`: array | Low | Render progress indicators in the assistant chat to show completion status, task progress, or step-by-step advancement. Use this whenever you need to visualize  |
| `render_scatter_plot` | Render Scatter Plot | `title`: string<br>`description`: string<br>`xAxis`: string<br>`yAxis`: string<br>`data`: array<br>`color`: string | Low | Render a scatter plot (X/Y correlation chart) in the assistant chat. Use when you have two numeric dimensions per data point (e.g. speed vs. accuracy, cost vs.  |
| `render_table` | Render Table | `title`: string<br>`description`: string<br>`columns`: array<br>`rows`: array | Low | Render a static table in the assistant chat to display structured data, comparisons, or tabular information. Use this whenever you need to present data in a tab |
| `render_timeline` | Render Timeline | `title`: string<br>`description`: string<br>`layout`: enum<br>`events`: array | Low | Render a timeline in the assistant chat to display sequences of events, milestones, or processes. Use this whenever you need to show chronological data (e.g. pr |
| `render_tree` | Render Tree | `title`: string<br>`description`: string<br>`nodes`: array | Low | Render a hierarchical tree structure in the assistant chat to display nested data, org charts, or decision trees. Use this whenever you need to show hierarchica |

## SDLC

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `aws_deploy` | aws_deploy | `environment`: string<br>`service`: string | High | Deploy a service to an environment (simulated when no cloud is configured). |
| `confluence_publish` | confluence_publish | `title`: string<br>`content`: string<br>`space`: string<br>`pageId`: string<br>`parentPageId`: string | Medium | Publish or update a Confluence page (falls back to the knowledge base when Confluence is not configured). |
| `confluence_read` | confluence_read | `pageId`: string | Low | Read a Confluence page by id (or its local knowledge-base equivalent). |
| `db_apply_migration` | db_apply_migration | `migrationId`: string | Low | Apply a previously generated database migration. |
| `db_generate_migration` | db_generate_migration | `description`: string<br>`type`: string | Low | Generate a database migration from a natural-language description. |
| `execute_playwright_test` | execute_playwright_test | `testPath`: string | Medium | Run a Playwright end-to-end test suite and return pass/fail results. |
| `execute_unit_tests` | execute_unit_tests | `path`: string<br>`suite`: string<br>`watch`: boolean | Medium | Run the unit test suite and return results. |
| `generate_mermaid` | generate_mermaid | `diagramType`: string<br>`content`: string | Low | Generate a Mermaid diagram of the given type from content. |
| `invoke_lsp` | invoke_lsp | `method`: string<br>`params`: object | Medium | Invoke a language-server method for code intelligence. |
| `jira_create_bug` | jira_create_bug | `summary`: string<br>`description`: string<br>`priority`: string<br>`projectKey`: string | Low | File a Jira bug ticket (persists locally when Jira is not configured). |
| `jira_create_epic_and_stories` | jira_create_epic_and_stories | `epicName`: string<br>`stories`: array<br>`projectKey`: string | Medium | Create a Jira epic with child user stories (persists to the knowledge base when Jira is not configured). |
| `jira_create_sprint` | jira_create_sprint | `name`: string<br>`boardId`: number<br>`startDate`: string<br>`endDate`: string | Medium | Create a Jira sprint (records a local backlog artifact when Jira is not configured). |
| `jira_jql_search` | jira_jql_search | `jql`: string<br>`fields`: array<br>`limit`: number | Low | Search Jira issues with a JQL query. Returns matching issues (empty when Jira is not configured). |
| `knowledge_graph_query` | knowledge_graph_query | `query`: string<br>`limit`: number | Low | Query the org knowledge graph for related context. |
| `oddjob_prediction_windowing` | oddjob_prediction_windowing | `horizon`: number<br>`metrics`: array | Low | Forecast the given metrics over a horizon window. |
| `run_dependency_audit` | run_dependency_audit | `path`: string | Medium | Run a dependency vulnerability audit on the project. |
| `slack_post_message` | slack_post_message | `channel`: string<br>`message`: string | Low | Post a message to a Slack channel (no-op record when Slack is not configured). |
| `trigger_hil_approval` | trigger_hil_approval | `formId`: string<br>`data`: object | Medium | Trigger a human-in-the-loop approval form for a decision gate. |

## SPATIAL

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `find_neighbouring_regions` | find_neighbouring_regions | `regionId`: number<br>`rings`: number | Low | Find regions geographically adjacent to a given region. Adjacency is computed from the cell sets at query time, not stored, so it stays correct when a boundary  |
| `geofence_spatial_evaluate` | geofence_spatial_evaluate | `assetId`: string<br>`assetName`: string<br>`latitude`: number<br>`longitude`: number<br>`velocityKmh`: number<br>`zoneId`: string<br>`zoneName`: string<br>`zoneType`: enum<br>`eventType`: enum<br>`maxDwellSlaMinutes`: number<br>`agentId`: string | Medium | Process spatial telemetry coordinates against geofence boundaries (ENTER, DWELL, EXIT) to detect SLA breaches and trigger FormAgent UIs. |
| `h3_hexagonal_spatial_evaluate` | h3_hexagonal_spatial_evaluate | `assetId`: string<br>`assetName`: string<br>`latitude`: number<br>`longitude`: number<br>`speedKmh`: number<br>`riskFluxDensity`: number<br>`resolution`: number | Low | Evaluates position on Uber H3 hexagonal mesh with 6-neighbor isotropic radial expansion and O(1) bitwise spatial zoom. |
| `list_signal_feeds` | List Signal Feeds | — | Low | List the signal feeds configured for this organization — what events Signal Studio can already see, with each feed's name, source type, URL, status, and last su |
| `list_spatial_regions` | list_spatial_regions | `limit`: number | Low | List this organization's named geographic areas (regions, zones, corridors), with the size and resolution range of each area's H3 cell set. |
| `locate_position_in_regions` | locate_position_in_regions | `latitude`: number<br>`longitude`: number<br>`precisionMetres`: number | Low | Determine which named regions a measured position falls inside. Requires the fix's accuracy in metres. Returns 'inside' and 'indeterminate' separately: a region |
| `mount_signal_studio` | Mount Signal Studio | `view`: enum<br>`signalId`: string<br>`title`: string | Low | Mounts Signal Studio in the side rail beside the CREW conversation, allowing visual inspection of spatial H3 telemetry, market signals, and geofence events. |

## Salesforce

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `salesforce_create_record` | Create Salesforce Record | `object_type`: string<br>`fields`: object | Medium | Create a new Salesforce record (Lead, Contact, Opportunity, Account, Case, etc.). |
| `salesforce_get_record` | Get Salesforce Record | `object_type`: string<br>`record_id`: string<br>`fields`: array | Low | Retrieve a specific Salesforce record by ID. |
| `salesforce_query` | Salesforce SOQL Query | `soql`: string | Medium | Run a SOQL query against Salesforce to retrieve records (Leads, Opportunities, Contacts, Accounts, etc.). |
| `salesforce_search` | Salesforce SOSL Search | `search_term`: string<br>`objects`: array | Low | Full-text search across multiple Salesforce objects using SOSL. |
| `salesforce_update_record` | Update Salesforce Record | `object_type`: string<br>`record_id`: string<br>`fields`: object | Medium | Update fields on an existing Salesforce record. |

## Security

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `aggregate_findings` | aggregate_findings | `sastFindings`: array<br>`scaFindings`: array | Low | Aggregates, de-duplicates, and calculates a Security Posture Score across SAST and SCA findings. |
| `generate_security_patch` | generate_security_patch | `finding`: any | Low | Generates surgical fix instructions or dependency upgrade diffs for a specific security finding. |
| `prioritize_vulnerabilities` | prioritize_vulnerabilities | `report`: any | Low | Groups security audit findings into Blockers, Sprint Fixes, and Backlog items based on CVSS severity. |
| `propose_security_audit` | Propose Security & Vulnerability Remediation Audit | `targetPackageOrService`: string<br>`scope`: string<br>`reason`: string | Medium | Proposes running an isolated dependency CVE scan, generating an automated patch branch, and validating container smoke tests. |
| `trigger_sast_scan` | trigger_sast_scan | `code`: string<br>`files`: array | Low | Executes Static Application Security Testing (SAST) on source files to detect secrets, SQLi, command injection, and prototype pollution. |
| `trigger_sca_scan` | trigger_sca_scan | `packageJsonContent`: string<br>`dependencies`: object | Low | Executes Software Composition Analysis (SCA) on dependency manifests to detect known CVEs and high-risk packages. |

## Self-Modification

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `ai_refactor` | AI-Assisted Refactoring | `filePath`: string<br>`instruction`: string | High | Use AI to suggest code refactoring. Does not apply changes automatically. SUPER ADMIN ONLY. |
| `code_create` | Create Code File | `filePath`: string<br>`content`: string<br>`commitMessage`: string<br>`branch`: string | High | Create a new file in the Oddjob codebase. SUPER ADMIN ONLY. |
| `code_delete` | Delete Code File | `filePath`: string<br>`confirm`: boolean<br>`commitMessage`: string<br>`branch`: string | High | Delete a file from the Oddjob codebase. Creates backup and requires confirmation. SUPER ADMIN ONLY. |
| `code_diff` | View Code Diff | `filePath`: string | High | View Git diff for a file or entire codebase. SUPER ADMIN ONLY. |
| `code_edit` | Edit Code File | `filePath`: string<br>`oldContent`: string<br>`newContent`: string<br>`commitMessage`: string<br>`branch`: string | High | Edit a file in the Oddjob codebase. Creates backup and Git commit. SUPER ADMIN ONLY. |
| `code_read` | Read Code File | `filePath`: string | High | Read a file from the Oddjob codebase. SUPER ADMIN ONLY. |
| `code_rollback` | Rollback Code Change | `filePath`: string<br>`commit`: string<br>`confirm`: boolean | High | Rollback a file to a previous Git commit or restore from backup. SUPER ADMIN ONLY. |
| `code_status` | View Code Status | — | High | View Git status and pending changes. SUPER ADMIN ONLY. |

## ServiceNow

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `servicenow_create_change_request` | Create ServiceNow Change Request | `short_description`: string<br>`description`: string<br>`type`: enum<br>`risk`: enum<br>`implementation_plan`: string<br>`backout_plan`: string<br>`assignment_group`: string | Low | Raise a change request in ServiceNow for a planned production change. |
| `servicenow_create_incident` | Create ServiceNow Incident | `short_description`: string<br>`description`: string<br>`caller_id`: string<br>`category`: string<br>`urgency`: enum<br>`impact`: enum<br>`assignment_group`: string | Low | Open a new incident in ServiceNow. |
| `servicenow_get_incident` | Get ServiceNow Incident | `incident`: string | Low | Get the full record for a single ServiceNow incident by its number (INC0010023) or sys_id. |
| `servicenow_search_incidents` | Search ServiceNow Incidents | `query`: string<br>`limit`: number | Low | Search ServiceNow incidents using encoded query syntax (e.g. 'active=true^priority=1', 'state=2^assigned_toISEMPTY', 'short_descriptionLIKEvpn'). |
| `servicenow_search_knowledge` | Search ServiceNow Knowledge Base | `query`: string<br>`limit`: number | Low | Search published ServiceNow knowledge articles for a resolution or how-to. |
| `servicenow_update_incident` | Update ServiceNow Incident | `incident`: string<br>`state`: enum<br>`urgency`: enum<br>`assigned_to`: string<br>`work_notes`: string<br>`comments`: string<br>`close_code`: string<br>`close_notes`: string | Medium | Update a ServiceNow incident — change state, reassign, or append a work note or customer-visible comment. |

## Simulation

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `propose_scenario_simulation` | Propose Scenario Simulation | `objective`: string<br>`strategies`: array<br>`iterations`: number<br>`reason`: string | Low | Proposes running a multi-branch Monte Carlo / GMS PMI scenario simulation (e.g., 10,000 iterations) to stress-test competing strategies, assess blast radius, an |

## Spatial

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `propose_spatial_analysis` | Propose Spatial Telemetry & Anomaly Analysis | `targetArea`: string<br>`resolution`: number<br>`metrics`: array<br>`reason`: string | Low | Proposes running an Eulerian Uber H3 hexagonal spatial flux and geofence dwell-time anomaly analysis. Identifies congestion clusters and geographic bottlenecks  |

## SpatialOperations

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `dispatch_spatial_squad` | Dispatch Hybrid Spatial Squad | `targetH3Index`: string<br>`squadId`: string<br>`missionObjective`: string<br>`estimatedDurationMinutes`: number<br>`assetRiskClass`: enum<br>`assignedPersonnel`: array<br>`targetScribeDocumentId`: string<br>`targetDatasetId`: string<br>`notifyOnCompletion`: boolean | Low | Evaluates safety trajectory and dispatches a hybrid human-agent squad to a target Uber H3 hexagonal cell index, mounting a Governance Gate approval checkpoint. |

## Strategy

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `generate_counter_strategy_epics` | generate_counter_strategy_epics | `blastRadius`: any<br>`targetSprint`: string<br>`managerGuidance`: string | Low | Generates structured roadmap backlog epics and user stories with acceptance criteria for Jira / GitHub sync. |
| `ingest_market_signals` | ingest_market_signals | `sources`: array<br>`keywordFilters`: array<br>`limit`: number | Low | Ingests and parses breaking market signals, competitor announcements, and tech news feeds. |
| `map_causal_blast_radius` | map_causal_blast_radius | `signal`: any | Low | Calculates market overlap and maps competitor features against internal Knowledge Graph modules to determine threat level. |

## Stripe

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `stripe_create_refund` | Create Stripe Refund | `payment_intent_id`: string<br>`amount`: number<br>`reason`: enum | Low | Issue a full or partial refund for a Stripe payment. Always confirm with user before executing. |
| `stripe_get_customer` | Get Stripe Customer | `email`: string<br>`customer_id`: string | Low | Look up a Stripe customer by email or customer ID. |
| `stripe_get_payment_intent` | Get Stripe Payment Intent | `payment_intent_id`: string | Low | Retrieve a Stripe payment intent by ID to check payment status. |
| `stripe_list_invoices` | List Stripe Invoices | `customer_id`: string<br>`status`: enum<br>`limit`: number | Low | List Stripe invoices for a customer, optionally filtered by status. |
| `stripe_list_subscriptions` | List Stripe Subscriptions | `customer_id`: string<br>`status`: enum<br>`limit`: number | Low | List Stripe subscriptions for a customer or across all customers. |

## Studio CRUD

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `agent_create_card` | agent_create_card | `name`: string<br>`description`: string<br>`personaType`: string<br>`capabilities`: array<br>`tools`: array<br>`enabled`: boolean | Medium | Create an agent card; requires the caller to manage this organization. |
| `agent_disable_card` | agent_disable_card | `agentId`: number<br>`userConfirmed`: any | High | Soft-delete an agent card, with organization management permission. |
| `agent_get_card` | agent_get_card | `agentId`: number | Low | Read an agent card before updating it. |
| `agent_list_cards` | agent_list_cards | — | Low | List agent cards in the current organization. |
| `agent_update_card` | agent_update_card | `name`: string<br>`description`: string<br>`personaType`: string<br>`capabilities`: array<br>`tools`: array<br>`enabled`: boolean<br>`agentId`: number | Medium | Update an agent card; organization management permission is checked from the caller identity. |
| `computer_archive_skill` | computer_archive_skill | `skillId`: string<br>`userConfirmed`: any | Low | Archive a saved skill without running a desktop action. |
| `computer_create_skill` | computer_create_skill | `recordingId`: string<br>`name`: string<br>`goal`: string | Medium | Create a draft skill from an existing recording in this organization; does not replay it. |
| `computer_get_skill` | computer_get_skill | `skillId`: string | Low | Read a saved computer-use skill without running it. |
| `computer_update_skill` | computer_update_skill | `skillId`: string<br>`name`: string<br>`description`: string<br>`goalExample`: string | Medium | Update a saved skill name, description or goal without executing it. |
| `form_archive` | form_archive | `formId`: number<br>`userConfirmed`: any | Low | Archive a form while preserving history and existing references. |
| `form_create` | form_create | `name`: string<br>`schema`: object | Medium | Create a saved Form Studio draft. Does not publish it. |
| `form_get` | form_get | `formId`: number | Low | Read a Form Studio draft, schema and revision before editing. |
| `form_list` | form_list | — | Low | List accessible Form Studio drafts and IDs before editing. |
| `form_update` | form_update | — | Medium | Save a form draft at the revision returned by form_get; rejects stale edits. Does not publish. |
| `media_add_scene` | media_add_scene | `productionId`: number<br>`title`: string<br>`synopsis`: string | Medium | Create a storyboard scene in a production. |
| `media_create_production` | media_create_production | `title`: string<br>`style`: string | Medium | Create a Media Studio production draft without rendering or spending. |
| `media_delete_scene` | media_delete_scene | `sceneId`: number<br>`userConfirmed`: any | High | Delete an explicitly requested storyboard scene using Media Studio lifecycle checks. |
| `media_get_production` | media_get_production | `productionId`: number | Low | Read a production including its scenes and shots before editing. |
| `media_list_productions` | media_list_productions | — | Low | List accessible Media Studio productions. |
| `media_update_production` | media_update_production | `productionId`: number<br>`title`: string<br>`style`: string | Medium | Update the title or style of a production without rendering. |
| `media_update_scene` | media_update_scene | `sceneId`: number<br>`title`: string<br>`synopsis`: string<br>`location`: string<br>`mood`: string | Medium | Update a storyboard scene. |
| `project_archive` | project_archive | `projectId`: number<br>`userConfirmed`: any | Low | Archive a project; requires ownership and no open cycles. |
| `project_create` | project_create | `name`: string<br>`description`: string<br>`objective`: string | Medium | Create a project owned by the caller. |
| `project_get` | project_get | `projectId`: number | Low | Read a project with membership checks. |
| `project_list` | project_list | — | Low | List projects accessible to the caller. |
| `project_update` | project_update | `projectId`: number<br>`name`: string<br>`description`: string<br>`objective`: string | Medium | Update project name, description or objective; requires project edit permission. |
| `scribe_add_station` | scribe_add_station | `documentId`: number<br>`title`: string<br>`content`: string | Medium | Create a section in the active branch of an existing manuscript. |
| `scribe_delete_station` | scribe_delete_station | `nodeId`: number<br>`userConfirmed`: any | High | Delete the explicitly requested manuscript section and refresh its table of contents. |
| `scribe_list_documents` | scribe_list_documents | — | Low | List the organization manuscript tree. |
| `scribe_rename_station` | scribe_rename_station | `nodeId`: number<br>`title`: string | Low | Rename an existing manuscript section without changing its prose. |
| `signal_create_feed` | signal_create_feed | `name`: string<br>`sourceType`: any<br>`url`: string<br>`pollingIntervalSeconds`: number<br>`enabled`: boolean | Medium | Create a validated signal feed. Disabled by default; credentials are managed separately. |
| `signal_disable_feed` | signal_disable_feed | `feedId`: number<br>`userConfirmed`: any | High | Soft-delete a signal feed by disabling polling, retaining history. |
| `signal_get_feed` | signal_get_feed | `feedId`: number | Low | Read feed configuration with authentication credentials redacted. |
| `signal_update_feed` | signal_update_feed | — | Medium | Update a signal feed name, polling interval or enabled state. Credentials and tenant identity cannot be changed. |

## StudioCollaboration

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `apply_studio_contribution` | Apply an Approved Contribution | `proposalId`: string | Low | Applies a studio contribution the user approved on its card. Do not call this directly — it is called automatically by the crew service after the user clicks Ap |
| `propose_studio_contribution` | Propose a Studio Contribution | `targetStudio`: enum<br>`targetLabel`: string<br>`targetId`: any<br>`rationale`: string<br>`diff`: array<br>`checks`: array<br>`requiresApproval`: boolean<br>`applyAction`: object | High | Introduces the agent's own suggestion to a live studio (Flow, Scribe, Form, Signal, Prediction, Media, Project, or Computer Use) and surfaces it to the user as  |

## System Architecture

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `query_platform_structure` | Query Platform Structure | — | Low | Explore relationship paths between technical entities (e.g., 'How do I navigate to the SaaS Connector screen?'). |
| `search_platform_nodes` | Search Platform Entities | `query`: string<br>`label`: string<br>`limit`: number | Low | Search for technical entities within the Oddjob platform (services, UI components, API routes, database schemas). Use this to find where a specific feature is l |

## System Management

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `create_job` | Create Job | `name`: string<br>`type`: enum<br>`description`: string<br>`config`: object<br>`outputDatasetId`: number | High | Create a new job. Requires admin permissions. Types include: shell, curl, python, ai_api_call, ai_agent, transformer, openapi, selenium, sql_query, slack_post,  |
| `delete_job` | Delete Job | `jobId`: number<br>`userConfirmed`: boolean | High | Delete a job. Requires admin permissions. IMPORTANT: You MUST ask user to confirm before executing this delete. |
| `get_credential_info` | Get Credential Info | `credentialId`: number<br>`credentialName`: string | Low | Get information about a specific credential by ID or name. Returns metadata only and whether its secret is set (secretSource: stored = encrypted for the organiz |
| `get_health_triage_brief` | Get Health Triage Brief | — | Low | Retrieve a consolidated system health triage brief containing active alerts, circuit breakers, recent events, and resource pressures. |
| `get_job_details` | Get Job Details | `jobId`: number<br>`jobName`: string | Low | Get detailed configuration of a specific job. |
| `get_oddjob_copilot_guide` | Get Oddjob Copilot Guide | `includeFullManifest`: boolean | Low | Return the canonical Oddjob Copilot operating guide: guided flows, safe commands, trust questions, capability next actions, and readiness checks. Use before rec |
| `get_system_health` | Get System Health | — | Low | Get current system health status including live worker queue depths and Redis connectivity. |
| `list_available_mcp_capabilities` | Discover Capabilities | `search`: string | Low | Browse available but currently inactive MCP tools. Use this to identify if the system has capabilities you need that aren't yet enabled. |
| `list_credentials` | List Credentials | `type`: string | Low | List credentials available in the organization. Returns metadata only (names, types, descriptions) and where each secret lives (secretSource: stored = encrypted |
| `list_failed_jobs` | List Failed Jobs | `limit`: number | Low | List recently failed pipeline executions. |
| `list_jobs` | List Jobs | `search`: string<br>`type`: string<br>`limit`: number | Low | List all jobs in the organization. Jobs are reusable task definitions that can be executed as pipeline steps. |
| `list_pending_interventions` | Decision Inbox | `limit`: number | Low | List all active Human-In-The-Loop (HIL) requests and pending interventions. Use this to identify why a mission might be waiting for user input. |
| `python` | Execute Python Code | `code`: string | Medium | Execute Python code securely in a sandboxed container. Useful for data analysis, complex logic, and scientific computing. |
| `request_mcp_tool` | Request Tool Activation | `toolName`: string<br>`reason`: string | Low | Request an administrator to enable a specific MCP server to help fulfill the current mission. |
| `shell` | Execute Shell Command | `command`: string | High | Execute a shell command on the server. Useful for diagnostics (ps, netstat, df, etc.). Use with caution. |
| `update_job` | Update Job | `jobId`: number<br>`name`: string<br>`description`: string<br>`config`: object<br>`isActive`: boolean<br>`outputDatasetId`: number | Medium | Update an existing job. Requires admin permissions. |

## Travel

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `flighthub_booking_status` | FlightHub booking progress | `task_id`: string | Low | Read the status and latest steps of a booking computer-use task started by an approved flighthub_booking proposal — running, waiting on a person (needs_confirma |
| `flighthub_get_offer` | Read selected FlightHub offer | `session_id`: string<br>`offer_ref`: string | Low | Read a saved executed search offer, scoped to the requesting user. This is indicative search evidence, not a new live fare check. |
| `flighthub_lookup_airports` | Find airport codes | `query`: string<br>`country`: string<br>`max_results`: number | Low | Resolve city, airport name or IATA code using the bundled OurAirports directory. Returns actual airport names and codes, including multiple airports for ambiguo |
| `flighthub_propose_booking` | Propose FlightHub booking | `session_id`: string<br>`offer_ref`: string<br>`offer_index`: number<br>`itinerary`: string<br>`origin_code`: string<br>`destination_code`: string<br>`airline`: string<br>`depart_at`: string<br>`arrive_at`: string<br>`price_display`: string<br>`passengers`: number<br>`passenger_note`: string<br>`results_url`: string<br>`max_total`: number<br>`reason`: string | Low | Save an approval card for an offer returned by flighthub_search_flights. Only session_id and offer_ref identify the offer; itinerary and prices are loaded from  |
| `flighthub_search_flights` | Search FlightHub flights | `origin`: string<br>`destination`: string<br>`depart_date`: string<br>`return_date`: string<br>`trip_type`: enum<br>`adults`: number<br>`children`: number<br>`infants`: number<br>`cabin_class`: enum<br>`max_results`: number<br>`session_id`: string | Low | Search FlightHub for flights in the organization’s real desktop browser (trycua). Returns normalized offers — route, airline, times, duration, stops, cabin, pri |

## Tutorials & Onboarding

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `launch_score_tutorial` | Launch Guided Tutorial | `trackId`: string<br>`reason`: string | Medium | Launch an interactive, step-by-step UI walkthrough on screen for the user (e.g. 'chain:operator-flight-deck', 'chain:developer-forge', 'chain:full-platform-imme |

## Twilio / SMS

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `sms_list_messages` | List Twilio Messages | `to`: string<br>`from`: string<br>`limit`: number | Low | List recent SMS messages sent or received via Twilio. |
| `sms_send` | Send SMS | `to`: string<br>`message`: string<br>`from`: string | Medium | Send an SMS text message via Twilio. Requires a Twilio credential with account SID, auth token, and from number. |
| `sms_send_bulk` | Send Bulk SMS | `recipients`: array<br>`message`: string | Medium | Send the same SMS to multiple recipients. Use sparingly — confirm recipient list before sending. |

## Ungrouped

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `accept_bid` | accept_bid | `bid_id`: number<br>`task_id`: number | Low | Accept a bid from another agent to complete your task. |
| `bind_screen_io` | Bind Screen Input/Output | `targetStageId`: string<br>`targetPropKey`: string<br>`sourceStageId`: string<br>`sourceOutputKey`: string<br>`defaultValue`: any<br>`transform`: string | Low | Wires an output field submitted on an upstream screen into a prop/input required by a downstream screen or action. |
| `commit_project_plan_to_cycle` | Save Project Plan as Cycle (pending approval) | `projectTitle`: string<br>`objective`: string<br>`budgetLimitUsd`: number<br>`tokenLimit`: number<br>`maxParallelMissions`: number<br>`targetSlaDays`: number<br>`waves`: array<br>`projectId`: number | Low | Saves a Project Studio wave plan as an Operational Cycle that is PENDING APPROVAL. Nothing runs until someone approves the cycle. Waves carry dependencies (pred |
| `delegate_task` | delegate_task | `goal`: string<br>`maxIterations`: number | Low | Delegate a task to a sub-agent that will work autonomously toward a specific goal. |
| `deploy_forged_app` | Deploy Forged Application | `name`: string<br>`slug`: string<br>`description`: string<br>`blueprintSlug`: string<br>`projectId`: number<br>`components`: array<br>`pipelineIds`: array<br>`stages`: array<br>`isPublic`: boolean | Low | Deploys an application blueprint or draft into the active workspace apps registry with status 'active'. Generates the live app URL, links pipelines, components, |
| `evaluate_functional_gaps` | Evaluate Blueprint Functional Gaps (GQE) | `blueprint`: object | Low | Lints an Assembly Blueprint for the 6 defect classes: Unbound I/O, High-Blast-Radius Governance Gaps, Dead-End Branches, Capability Deficits, Observability Defi |
| `execute_visual_query` | Execute Visual Query (X-Ray) | `scope`: string<br>`filterType`: string | Low | Queries the Oddjob System X-Ray graph to discover nodes (pipelines, agents, datasets, missions, apps, etc.) and their structural relationships (TRIGGERS, WRITES |
| `gcal_event_instances` | gcal_event_instances | `calendar_id`: string<br>`event_id`: string<br>`page_token`: string | Low | List occurrences of a recurring event; use an occurrence ID to change only that occurrence. |
| `gcal_free_busy` | gcal_free_busy | `calendar_ids`: array<br>`time_min`: string<br>`time_max`: string<br>`time_zone`: string | Low | Check availability across Google calendars. Calendar-specific errors are not availability. |
| `gcal_get_calendar` | gcal_get_calendar | `calendar_id`: string | Low | Read calendar metadata and its authoritative time zone. |
| `gcal_get_event` | gcal_get_event | `calendar_id`: string<br>`event_id`: string | Low | Read full Google event details, recurrence, attendees and etag before editing. |
| `mount_builder_pod` | Mount In-Chat Builder Pod | `podComponent`: string<br>`stageId`: string<br>`title`: string<br>`props`: object | Low | Returns an assistant_app payload to mount an adaptive Builder Pod (ScaffoldPackPod, PipelineBuilderPod, AgenticHRPod, HILGovernancePod, MissionBriefPod, Dataset |
| `plan_app_architecture` | Plan Application Architecture | `appName`: string<br>`requirements`: string<br>`preferredArchetype`: enum<br>`capabilities`: array<br>`integrations`: array | Low | Classifies application requirements into a supported archetype and returns the layout, surfaces, capabilities, and best CREW/Forge construction path. Use before |
| `preview_screen_flow` | Preview Screen Data Flow | `stages`: array | Low | Generates a visual Mermaid diagram and data lineage summary for a multi-step screen application. |
| `propose_app_draft` | Propose Application Draft | `name`: string<br>`description`: string<br>`blueprintSlug`: string<br>`projectId`: number<br>`components`: array<br>`pipelineIds`: array | Medium | Configures and saves a new Application Draft to the Organization's App Forge registry and creates an approval-gated proposal card in chat. Use this whenever ask |
| `propose_cycle_draft` | Propose Operational Cycle Draft | `name`: string<br>`reason`: string<br>`scaffoldPacks`: array<br>`stages`: array | High | Proposes an Operational Cycle or Pipeline Blueprint draft for human review and approval. This does NOT deploy or execute the cycle — it creates an approval-gate |
| `render_mermaid_diagram` | Render Mermaid Diagram (Inline) | `code`: string<br>`title`: string | Low | Renders any Mermaid diagram type directly inline in the assistant chat. Use this for sequence diagrams, class diagrams, ER diagrams, Gantt charts, Sankey diagra |
| `render_workflow_diagram` | Render Workflow Dependency Diagram | `stages`: array<br>`code`: string<br>`title`: string | Low | Generates and renders a Mermaid diagram inline in the chat. Two modes: (1) Pass 'stages' to auto-generate a Blueprint execution flowchart with ready/active/bloc |
| `request_help` | request_help | `task_description`: string | Low | When you are unable to complete a task, use this tool to post a help request to the agent marketplace. Another agent may be able to help. |
| `resolve_assembly_dag` | Resolve Assembly DAG & Prerequisites | `requestedPacks`: array | Medium | Evaluates an Assembly Blueprint or list of scaffold packs to compute the topological execution order, identify missing prerequisites, and detect pack conflicts. |
| `review_bids` | review_bids | `task_id`: number | Low | Review the bids submitted by other agents for a task you created. |
| `scaffold_multistep_app` | Scaffold Multi-Step Application | `appName`: string<br>`description`: string<br>`archetype`: enum<br>`layout`: enum<br>`capabilities`: array<br>`stages`: array | Low | Assembles a multi-screen application blueprint where forms and submitted results on previous screens flow into subsequent screens, pipelines, and ontology actio |
| `start_multistep_run` | Start Multi-Step Run | `blueprint`: object<br>`title`: string | Medium | Create a multi-step assembly run from a blueprint and mount it inline in chat as a step-by-step wizard. Use when a task needs several ordered stages with depend |
| `synthesize_fullstack_spec` | Synthesize Full-Stack Application Spec | `appName`: string<br>`description`: string<br>`fields`: array<br>`trigger`: string<br>`projectKey`: string | High | Infers and synthesizes an end-to-end 5-layer application architecture (UI form fields, pipeline DAG execution steps, Dataset schema, and project scoping) from a |

## User Profile

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `get_synthetic_persona` | Get Synthetic Persona | — | Low | Retrieves the synthesized user persona, including archetype, focus topics, risk posture, working style, and communication directives. |
| `get_user_context_graph` | Get User Context Graph | `limit`: number | Low | Retrieves the user's top interest topics, 14-day decayed recency weights, and recent project activity history. |
| `get_user_ocean_profile` | Get User OCEAN Profile | — | Low | Retrieves the assessed Big Five (OCEAN) personality profile for the user along with behavioral adaptation hints. |

## User Understanding

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `check_user_knows` | Check What User Knows | `topic`: string | Low | Check whether this user has already been told about a topic, so you can skip re-explaining it or deliberately recap. Requires session consent. |
| `get_user_profile` | Get User Profile | — | Low | Read the user's interaction profile: working style, what they already know, beliefs that look mistaken, and open questions they have. Requires session consent — |
| `request_user_profile_access` | Request Profile Access | `reason`: string | Low | Ask the user for permission to read their interaction profile (what they have been told, what they believe, their working style) for this session. Raises an app |

## Video Content

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `apply_media_change` | Apply a Media Studio Change | `proposal`: object | Low | Saves the edits on a Media Studio change card the author applied. Refused when the scene has changed since the card was drafted. |
| `apply_media_story` | Write a Drafted Story into Media Studio | `proposal`: object | Low | Writes the scenes on a Media Studio story card the author applied. Refused when the production's scenes have changed since the card was drafted. |
| `apply_style_bible` | Save a Drafted Style Bible | `proposal`: object | Low | Saves the Style Bible on a card the author applied, to the production's Project Space and to the production's own look. Every keyframe and take rendered afterwa |
| `assemble_scene_timeline` | Assemble a Scene Reel | `sceneId`: number<br>`productionId`: number<br>`sceneKey`: string | Low | Cut a Media Studio scene's approved takes into one reel, in shot order with each shot's transition. Give the scene's id, or the production id and scene key (e.g |
| `mount_media_studio` | Mount Media Studio | `productionId`: number<br>`productionTitle`: string<br>`create`: boolean<br>`aspectRatio`: enum<br>`sceneId`: string | Medium | Opens Media Studio beside the CREW conversation on a film production: its story, storyboard, shots, takes and reels. Pass productionId, or productionTitle with  |
| `propose_media_change` | Draft a Media Studio Change | `selection`: object<br>`instruction`: string | Low | Drafts a change to a Media Studio scene (its direction, plot points, shots and dialogue) about something the author marked, and returns it as a card for the aut |
| `propose_media_story` | Draft a Media Studio Story | `productionId`: number<br>`premise`: string<br>`basedOn`: array | Low | Drafts scenes for a Media Studio production from what the author described — each with its direction, beats, shots and dialogue — and returns them as a card for |
| `propose_style_bible` | Draft a Media Studio Style Bible | `productionId`: number<br>`instruction`: string<br>`basedOn`: object | Low | Drafts the Style Bible a production is shot in — its look, period, wardrobe rules, negative prompt and character continuity anchors — and returns it as a card f |
| `render_dailies_deck` | Render Dailies Review Deck | `sceneId`: string<br>`sceneTitle`: string<br>`budgetSpendUsd`: number<br>`shots`: array | Medium | Write a Dailies review summary in markdown: each shot's status, prompt, camera direction, continuity seed and clip link, exactly as given in the parameters. |
| `review_media_production` | Say What a Production Needs | `productionId`: number<br>`question`: string | Low | Reads a Media Studio production — its story, scenes, shots, look and what has been rendered — and answers a question about it in words. Proposes nothing and cha |
| `search_videos` | Search Videos | `query`: string<br>`limit`: number | Low | Search for relevant YouTube video clips, transcripts, and metadata. Use this when a user asks for video examples, visual tutorials, or topical clips. |
| `seedance_check_status` | Check a Seedance Take | `takeId`: number | Low | Check on a Media Studio take by its takeId: whether it is waiting for approval, rendering, ready for review (with its video), failed, or a simulation. |
| `seedance_estimate_cost` | Estimate Seedance Take Cost | `shotCount`: number<br>`durationSeconds`: number<br>`resolution`: enum | Low | Estimate what Seedance takes will cost at fal.ai's list price for Seedance 2.0. A take is charged only when it renders. |
| `seedance_submit_shot` | Ask for a Seedance Take | `shotId`: number<br>`note`: string<br>`endOnNextKeyframe`: boolean | Medium | Ask for a Seedance take of a Media Studio shot by its shotId. The shot's direction and dialogue become the prompt, the take starts from the shot's keyframe when |

## Web & Browser

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `browse_web` | Browse Web | `url`: string<br>`mode`: enum | Low | Visit a URL and extract its text content. Useful for reading documentation, news, or articles. Returns the page title and a text summary. |
| `google_search` | Google Search | `query`: string | Low | Search the web for a query and return snippets or full page summaries of the top results. Uses multiple search backends for reliability. |
| `http_query` | HTTP Query | `url`: string<br>`method`: enum<br>`params`: object<br>`jsonPath`: string<br>`cacheTtlSeconds`: number | Low | Query a live external HTTP/HTTPS REST API endpoint with SSRF protections, caching, parameter merging, and optional JSON path extraction. Ideal for real-time wea |

## Webhooks

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `webhook_get` | HTTP GET Request | `url`: string<br>`headers`: object<br>`timeout_ms`: number | Low | Make an HTTP GET request to an external URL and return the response body. Useful for polling APIs or reading external data. |
| `webhook_send_notification` | Send Notification | `url`: string<br>`message`: string<br>`title`: string<br>`level`: enum | Medium | Send a notification to a configured webhook (Slack, Discord, Teams, PagerDuty, or any webhook URL). Provide the url and a message. |
| `webhook_trigger` | Trigger Webhook | `url`: string<br>`payload`: object<br>`headers`: object<br>`retries`: number<br>`timeout_ms`: number | Medium | Send an HTTP POST webhook to an external URL with a JSON payload. Supports retries and custom headers. Use this for event-driven integrations with external syst |

## YouTube

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `youtube_get_channel` | Read YouTube channel | `channel_id`: string | Low | Read a named channel, or the authenticated user’s channel when channel_id is omitted. Returns the channel profile and its latest uploads. |
| `youtube_get_comment` | Read YouTube comment | `comment_id`: string | Low | Read one exact comment before discussing or replying to it. |
| `youtube_get_playlist` | Read YouTube playlist | `playlist_id`: string | Low | Read one playlist’s metadata. |
| `youtube_get_transcript` | Read YouTube transcript | `video_id`: string<br>`transcribe_audio`: boolean<br>`max_chars`: number | Medium | Extract a video’s spoken content as text from its published captions. Use this to review what a video says before discussing it. When no captions exist, set tra |
| `youtube_get_video` | Read YouTube video details | `video_id`: string | Low | Read a video’s title, description, duration, statistics and publication status. This is metadata only, not video analysis or a transcript. |
| `youtube_list_comments` | Read YouTube comments | `video_id`: string<br>`max_results`: number<br>`page_token`: string | Low | Read top-level comment threads on a video. Reply counts are supplied; the embedded replies may be incomplete. Reports pagination. |
| `youtube_list_playlist_videos` | List YouTube playlist videos | `playlist_id`: string<br>`max_results`: number<br>`page_token`: string | Low | List videos in a playlist, including a channel uploads playlist. Reports pagination. Does not watch videos. |
| `youtube_list_playlists` | List YouTube playlists | `channel_id`: string<br>`max_results`: number<br>`page_token`: string | Low | List playlists for channel_id, or the connected user when omitted. Reports pagination. |
| `youtube_reply_comment` | Reply to YouTube comment | `parent_comment_id`: string<br>`text`: string | Medium | Publish an approved reply to a specific YouTube parent comment. Requires write consent and human approval; do not call for a mere draft. |
| `youtube_search` | Search YouTube | `query`: string<br>`channel_id`: string<br>`max_results`: number<br>`page_token`: string | Low | Search live YouTube videos. Returns metadata, not a transcript or evidence of watching. Prefer playlist reads for a known channel to conserve search quota. |

## Zendesk

| Capability ID | Name | Inputs | Risk* | Description |
| --- | --- | --- | --- | --- |
| `zendesk_create_ticket` | Create Zendesk Ticket | `subject`: string<br>`body`: string<br>`requester_email`: string<br>`priority`: enum<br>`tags`: array | Medium | Create a new Zendesk support ticket. |
| `zendesk_get_ticket` | Get Zendesk Ticket | `ticket_id`: number | Low | Get details and comments for a specific Zendesk ticket by ID. |
| `zendesk_search_tickets` | Search Zendesk Tickets | `query`: string<br>`per_page`: number | Low | Search Zendesk support tickets by query string. Supports Zendesk search syntax. |
| `zendesk_update_ticket` | Update Zendesk Ticket | `ticket_id`: number<br>`status`: enum<br>`priority`: enum<br>`comment`: string<br>`public_comment`: boolean | Medium | Update a Zendesk ticket status, priority, or add a comment. |

