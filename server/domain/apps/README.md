
# App Forge Domain

The App Forge is the heart of Oddjob's generative capabilities. It is responsible for taking a user's requirement and orchestrating a team of specialist AI agents to build, test, and deploy a fully functional web application.

## The App Forge Co-Pilot & Requirements Wizard

To enhance the intelligence and strategic value of the App Forge, the creation process is guided by a sophisticated **Requirements Wizard**. This "Co-Pilot" transforms the App Forge from a simple code generator into a strategic planning partner.

The wizard consists of the following steps:

### 1. The Idea
The user provides their initial, high-level application requirement in plain English.

### 2. The Business Case
The user's idea is sent to a specialist **"Business Analyst"** AI agent, which transforms the raw text into a structured Agile Business Case. This includes a Problem Statement, a Proposed Solution, a list of Key Features and User Stories, and measurable Success Metrics.

### 3. The Toolkit
The generated business case is used to perform a "Buy vs. Build" analysis. The `CapabilityDiscoveryService` searches the organization for existing Oddjob assets (Missions, Blueprints, etc.) that could be reused or repurposed, accelerating development.

### 4. The Blueprint
A **Logical Architecture Diagram** is generated and displayed to the user. This `react-flow` diagram provides a high-level visual plan of the proposed application, showing its key components and their relationships before a single line of code is written.

### 5. The Pre-Flight Check
Two specialist agents perform a final analysis:
- The **"Forecaster"** agent provides an estimated cost and build time.
- The **"Compliance Officer"** agent scans for security and compliance risks related to sensitive data.

### 6. Final Approval
The user reviews all the generated information and gives their final approval to "Ignite Forge," kicking off the multi-wave build process.

## The Build Process (Multi-Wave Architecture)

Once approved, the `ForgeSupervisor` agent orchestrates the build in a series of waves. It uses the structured data from the Co-Pilot to plan its work, building the core features in the first wave and then using a **Build -> Reflect -> Plan** loop to add functionality in subsequent waves until the full scope of the business case is met.
