# 🧠 Consumer Service (`services/consumer`)

The Consumer Service is the "Brain" of the Oddjob telemetry pipeline. It is a Python-based worker and API sidecar responsible for real-time belief updates, knowledge distillation, and providing specialized utility endpoints (scraping, PDF parsing, execution) for the main Node.js application.

## Mach 3 Service Role: `worker` / `mission`
In the Mach 3 distributed architecture:
- **Worker Pod**: Processes incoming intent pulses from RabbitMQ, updating Bayesian belief models for users.
- **Sidecar API**: Provides auxiliary compute services (scraping, embedding, distillation) that are better handled in the Python ecosystem.

## Core Responsibilities
- **Bayesian Inference**: Updates user "beliefs" (Symptom, Challenge, Opportunity, Risk, Effort) using a Bayesian engine based on incoming pulses.
- **Knowledge Distillation**: Extracts structured concepts and relationships from raw text to feed the Knowledge Graph.
- **Context Synthesis**: Merges disparate telemetry data into a cohesive user profile in Redis.
- **Utility API**: Offers high-level tools for agents and pipelines, including:
    - **Scraping**: Structured text extraction from URLs.
    - **PDF Parsing**: Text and metadata extraction from documents.
    - **Code Execution**: Restricted Python script execution for dynamic data processing.

## Integration Points
- **RabbitMQ**: Consumes from the `intent.raw` queue (v1).
- **Redis**: Primary store for user belief vectors and ephemeral context.
- **PostgreSQL**: Used for logging inference results and distillation metadata.
- **Gemini / AI APIs**: Leverages LLMs for complex distillation and synthesis tasks.

## Key Files
- `main.py`: Entry point for both the FastAPI server and the RabbitMQ consumer thread.
- `inference.py`: Implementation of the Bayesian Inference Engine.
- `distillation.py`: Logic for mapping text to knowledge structures.
- `synthesizer.py`: Orchestration for merging multi-source context.
- `pta_library.json`: Library of predefined "Patterns, Trends, and Anomalies" for inference.

## Routes (Port 8001)
- `POST /execute`: Run a restricted Python script.
- `POST /scrape`: Extract content from a web page.
- `POST /parse-pdf`: Convert PDF to structured text.
- `POST /distill`: Generate knowledge fragments from raw text.
- `GET /health`: Service health check.

## Testing Status
- [ ] Inference Engine: 🟡 Unit tests coverage for Bayesian updates
- [ ] API Endpoints: 🟡 Integration tests for scraping and PDF parsing
- [ ] Consumer Flow: 🔴 End-to-end telemetry flow untested in distributed mode
