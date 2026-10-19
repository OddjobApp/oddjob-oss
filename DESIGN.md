# Design System: Sales Pipeline Management
**Project ID:** Sales Pipeline Management

## 1. Visual Theme & Atmosphere
The Sales Pipeline Management system is designed for automated lead qualification, pipeline tracking, and revenue forecasting. Its atmosphere is one of efficiency and intelligent automation, leveraging AI agents to streamline sales processes. It aims to provide clear oversight and proactive management of sales opportunities, with a focus on seamless integration with external tools like CRM and JIRA. The system is structured to handle both automated and human-in-the-loop interventions for critical stages.

## 2. Color Palette & Roles
The "color palette" here represents the distinct functional components and their roles within the sales pipeline.

- **Primary System Theme (System Accent: #3b82f6)**: Represents the overall branding and primary interaction points of the system. This is the guiding color for the UI, indicating a modern and trustworthy application.
- **Lead Intake (Form: lead_intake)**: Signifies the initial stage of data capture for new sales opportunities. This is where raw lead information is structured for qualification.
- **Pipeline Review (Form: pipeline_review)**: Indicates a critical human intervention point for approvals and adjustments within the sales cycle, ensuring strategic oversight.
- **AI Sales Representative (Agent: ai-sales-rep)**: Represents the automated worker agent responsible for lead qualification, pipeline management, and initial outreach. Its role is to drive efficiency in routine tasks.
- **AI Sales Manager (Agent: ai-sales-manager)**: Signifies the supervisory AI agent focused on strategic analysis, forecasting, and overall pipeline health. Its role is to provide high-level insights and guidance.
- **Qualify Lead (Mission: mission-qualify-lead)**: Represents the process of evaluating potential leads for fit and potential value.
- **Add to Pipeline (Mission: mission-add-to-pipeline)**: Denotes the action of formally incorporating a qualified lead into the sales pipeline for active pursuit.
- **Generate Revenue Forecast (Mission: mission-generate-forecast)**: Highlights the analytical process of predicting future revenue based on current pipeline data.
- **Review Pipeline Updates (Mission: mission-review-pipeline)**: Emphasizes the human gate for validating and approving changes to the sales pipeline.
- **Publish Forecast (Mission: mission-publish-forecast)**: Represents the final step of disseminating the generated revenue forecast to relevant stakeholders.

## 3. Typography Rules
The "typography" of this system refers to its communication style, particularly through agent prompts and descriptions.

- **System-level Descriptions (Blueprint Metadata)**: Clear, concise, and functional language, focusing on objective definitions of processes and integrations. (e.g., "Automated lead qualification, pipeline tracking, and revenue forecasting.")
- **AI Agent Legends (Agent `legend` field)**: Evocative and role-defining language, capturing the core function and strategic importance of each AI agent. (e.g., "Qualifies leads, manages pipeline, and forecasts revenue." for `ai-sales-rep`; "Analyzes pipeline health and forecasts revenue." for `ai-sales-manager`)
- **Mission Objectives (Mission `objective` field)**: Action-oriented and results-focused phrasing, clearly stating the goal of each mission. (e.g., "Qualify lead and determine fit"; "Generate revenue forecast from pipeline")
- **Step Descriptions (Mission `description` field)**: Detailed, imperative language outlining the specific actions within each mission step. (e.g., "Research company and decision makers"; "Calculate lead qualification score")
- **Form Labels (Form `label` field)**: User-friendly and self-explanatory terms for data input. (e.g., "Lead Name", "Estimated Deal Value")

## 4. Component Stylings
The "component stylings" describe the structure and interaction patterns of the system's core functional units.

*   **Agents (AI Workers/Supervisors):**
    *   **Architecture:** Defined roles (`worker`, `supervisor`), specific models (`claude-3.5-sonnet`), and bounded interaction (`max_iterations`, `token_budget`, `boundaries`).
    *   **Behavior:** Traits (`compliance`, `creativity`, `speed`) influence their operational style. Permissions (`jira:read`, `slack:write:channel`) dictate their access.
    *   **Interactions:** Utilize various tools (`knowledge_graph_query`, `jira_jql_search`) to perform actions and communicate outcomes.
*   **Missions (Workflows/Processes):**
    *   **Structure:** Composed of sequential `steps` with defined `actions` and `descriptions`. Can be `manual` or triggered `on_success` of other missions.
    *   **Types:** `mission` for automated or semi-automated processes; `milestone` for critical human review points.
    *   **Inputs/Outputs:** Clearly defined data flows (`inputs`, `outputs`) between missions.
    *   **Human-in-the-Loop:** `requires_human: true` and `form_ref` indicate points where human intervention is explicitly designed.
*   **Forms (Data Collection Interfaces):**
    *   **Fields:** Structured input fields (`text`, `select`, `textarea`) with validation (`required`) to ensure data integrity.
    *   **Purpose:** Designed to collect specific information (e.g., `lead_intake`) or gather approvals/decisions (e.g., `pipeline_review`).
*   **Integrations (External System Connectors):**
    *   **Configuration:** Defined by provider, endpoint, and API tokens, ensuring secure and robust connections to external services like JIRA, Confluence, and Slack.
    *   **Role:** Enable seamless data exchange and action execution across the enterprise ecosystem.

## 5. Layout Principles
The "layout principles" describe how the various components of the Sales Pipeline Management system are organized and interact to form a cohesive and functional whole.

-   **Modular Design:** The system is built with distinct, self-contained `agents`, `missions`, `forms`, and `integrations`. This modularity allows for clear separation of concerns and easier maintenance or extension.
-   **Sequential Workflow:** Missions are designed to execute in a defined `sequence` of steps, ensuring a logical progression through the sales pipeline stages. Triggers (`manual`, `on_success`) explicitly define dependencies and flow.
-   **Agent Orchestration:** AI agents are assigned primary responsibility for missions (`primary_agent`), orchestrating their execution and interacting with various tools and other system components.
-   **Data Flow:** `inputs` and `outputs` define the data contract between missions, ensuring that information is passed correctly and consistently through the pipeline.
-   **Human Escalation:** Critical decision points are explicitly designed with `requires_human: true` and linked to `forms`, ensuring that human oversight and approval are integrated into automated workflows. This creates a robust human-AI collaborative layout.
-   **Configuration-Driven:** The entire system is laid out through declarative YAML configuration, emphasizing transparency and ease of modification for defining the sales process.
