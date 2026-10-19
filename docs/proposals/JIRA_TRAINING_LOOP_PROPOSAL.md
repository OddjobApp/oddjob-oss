# JIRA Issue Resolution & Model Training Loop

## Overview
This specification outlines a closed-loop system for improving AI capabilities within Oddjob. The goal is to not just *solve* JIRA issues using AI, but to *capture* the solved examples (verified by humans) to train a smaller, faster, internal model.

## 1. Use Case Workflow

1.  **Ingestion**: A Pipeline fetches a JIRA Issue (Title, Description, Comments).
2.  **RAG Analysis**: The system retrieves relevant documentation (using Knowledge Graph/Vector Store) and prompts a powerful LLM (e.g., Gemini 1.5 Pro) to propose a solution.
3.  **Human Verification (HIL)**:
    *   A human expert receives a notification.
    *   They view the **original issue** and the **AI-proposed solution**.
    *   They **edit** the solution if necessary (correcting facts, code).
    *   They assign a **Confidence Score** (1-5) to the final quality.
4.  **Knowledge Capture**:
    *   If Approved & High Confidence: The (Issue, Final Solution) pair is stored in a dedicated `fine_tuning_datasets` table.
    *   The solution is *also* added to the Knowledge Graph as a "Verified Solution" node linked to the "Ticket" node, available for future RAG retrieval immediately.
5.  **Model Distillation**:
    *   Asynchronously, these "Golden Records" are exported to fine-tune a smaller model (e.g., Llama 3 8B or Gemini Nano).

## 2. Data Model Changes

### 2.1. Fine Tuning Datasets Table
We need a dedicated store for training examples, distinct from the general knowledge graph.

```typescript
export const fineTuningDatasets = pgTable("fine_tuning_datasets", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // e.g., "JIRA Resolution V1"
    description: text("description"),
    organizationId: integer("organization_id").references(() => orgs.id),
});

export const fineTuningExamples = pgTable("fine_tuning_examples", {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id").references(() => fineTuningDatasets.id),
    
    // The "Prompt" (Input)
    input: text("input").notNull(), // JSON or Text representation of the issue
    inputContext: jsonb("input_context"), // Metadata: { jiraId: "KAN-1", type: "Bug" }
    
    // The "Completion" (Output)
    output: text("output").notNull(), // The Verified Solution
    
    // Quality Metrics
    humanConfidence: integer("human_confidence").default(0), // 0-100 or 1-5
    originalAiConfidence: integer("original_ai_confidence"),
    
    // Lineage
    sourceJobId: integer("source_job_id"),
    sourcePipelineExecutionId: integer("source_pipeline_execution_id"),
    
    createdAt: timestamp("created_at").defaultNow(),
});
```

## 3. Pipeline Implementation Details

### 3.1. HIL Form Configuration
The `hil_forms` table will be used. We will define a standard "Solution Review" form schema:

```json
{
  "fields": [
    {
      "key": "verified_solution",
      "type": "markdown_editor",
      "label": "Review & Edit AI Solution",
      "defaultValue": "{{step.ai_solution.output}}", 
      "required": true
    },
    {
      "key": "confidence_score",
      "type": "slider", // or select
      "label": "Confidence Level (1-5)",
      "min": 1,
      "max": 5,
      "required": true
    },
    {
      "key": "tags",
      "type": "multi_select",
      "options": ["Bug Fix", "Configuration", "Documentation", "False Alarm"]
    }
  ]
}
```

### 3.2. New Job Type: `CaptureTrainingExample`
A specialized job or pipeline step functionality to write to `fine_tuning_examples`.

*   **Inputs**:
    *   `dataset_id`: Target dataset.
    *   `input_text`: The JIRA Issue content (mapped from Step 1).
    *   `output_text`: The Verified Solution (mapped from HIL Step Output).
    *   `confidence`: Mapped from HIL Step Output.

## 4. UI Enhancements

### 4.1. HIL Review Interface
*   Enhance the HIL Approval page to support `markdown_editor` with diffing capabilities (Original vs Edited).
*   Add the "Confidence" slider.

### 4.2. Dataset Manager
*   A new page under "Knowledge" -> "Datasets".
*   View list of captured examples.
*   **Export Button**: "Export to JSONL" (OpenAI/Gemini formatting).
*   **Stats**: "150 Examples collected", "Average Confidence: 4.8/5".

## 5. Deployment & Optimization Strategy
Once ~50-100 high-confidence examples are collected:
1.  User clicks "train" (or exports).
2.  Training job runs (external provider).
3.  New Model ID is updated in `systemSettings`.
4.  The "AI Analysis" step in the pipeline is updated to use the new `fine_tuned_model_id`.
5.  Cycle repeats with higher baseline accuracy.
