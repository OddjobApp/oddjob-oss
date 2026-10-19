# Comprehensive Proposal: Organization Folder Data Import

## 1. Executive Summary
This proposal introduces a robust **Folder Data Import** capability to Oddjob. It enables automated ingestion of files (documents, images, structured data) from secure, organization-specific folders into Oddjob execution pipelines. 

By leveraging a "Scheduler-based Polling" architecture, existing pipeline infrastructure, and flexible processing modes, this feature transforms Oddjob into a powerful data processing engine capable of handling real-world file workflows (OCR, ETL, AI Analysis) without complex external triggers.

---

## 2. Architecture & Security

### 2.1. Managed Storage Hierarchy
To ensure strict data isolation and security, we will implement a rigid directory structure on the server.
*   **Root**: `./storage/org_data/` (Configured via `ODDJOB_STORAGE_ROOT`)
*   **Structure**:
    ```text
    storage/org_data/
    ├── global/             # Shared resources (templates, common assets)
    ├── <org_id_1>/
    │   ├── incoming/       # Hot folder for new files (Poll Target)
    │   ├── processed/      # Archive for successful pipelines
    │   ├── error/          # Quarantine for failed jobs
    │   └── temp/           # Scratchpad for decompression/processing
    └── <org_id_2>/ ...
    ```
*   **Sandbox Policy**: All file operations (Read/Move/Delete) will be wrapped in a `StorageService` that validates paths against the organization's root. Symlinks will be disabled to prevent jailbreaks.

---

## 3. The `folder_import` Job Type

A new job type `folder_import` will be added to the registry. It functions as an **Extraction & Load** node.

### 3.1. Configuration Schema (Job Editor)
Users will configure the job with the following parameters:

| Category | Setting | Type | Description |
| :--- | :--- | :--- | :--- |
| **Source** | `folderPath` | Text | Relative path (e.g. `incoming/invoices`). |
| | `pattern` | Text | Glob pattern (e.g. `*.pdf`, `data_*.csv`). |
| | `recursive` | Bool | Whether to scan subdirectories. |
| **Processing** | `mode` | Select | `List Only` / `Read Content` / `Ingest Dataset`. |
| | `encoding` | Select | `UTF-8` (Text) or `Data URI` (Images/AI). |
| | `extractArchives` | Bool | **New**: Auto-extract `.zip`/`.tar` files before processing. |
| | `schema` | Object | Optional validation & mapping rules (see Sec 4). |
| **Lifecycle** | `postProcessAction` | Select | `None` / `Move File` / `Delete File`. |
| | `moveDestination` | Text | Target folder for `Move` action (e.g. `processed/`). |
| **Safety** | `maxBatchSize` | Number | Max files to process per run (prevent timeouts). |
| | `onBadRecord` | Select | `Skip` / `Fail Fast`. |

### 3.2. Processing Modes

#### A. List Only (Metadata)
*   **Output**: Array of file objects `{ name, path, size, created_at }`.
*   **Zip Support**: If `extractArchives=true` and input is `data.zip`, the output list contains the **inner files** (e.g. `["data/row1.csv", "data/row2.csv"]`).
*   **Use Case**: Pass this list to an **Iterator Job** to resize 100 images contained inside a single Zip upload.

#### B. Read Content (Memory)
*   **Output**: Array of `{ filename, content }`.
*   **Zip Support**: Returns content of **all extracted files**.
*   **Text/JSON**: `content` is the string or parsed JSON object.
*   **Images**: If `encoding="data_uri"`, `content` is a **Base64 Data URI**.
*   **Use Case**: Feed a JSON config to a script, or send an Image to GPT-4 Vision.

#### C. Ingest Dataset (Knowledge Store)
*   **Output**: `{ insertedRows: 500, datasetId: "..." }`.
*   **Action**: Automatically parses CSV/JSON and loads rows into an Oddjob Dataset.
*   **Use Case**: Load "Weekly Sales" CSV into the Knowledge Graph for analysis.

---

## 4. Workflows & Integration

### 4.1. The "Watcher" Workflow (Polling)
To detect new files without an always-on listener:
1.  **Schedule**: User schedules the pipeline (e.g., "Every 10 mins").
2.  **Poll**: The job checks `incoming/`.
3.  **Process**: It processes the first `maxBatchSize` files.
4.  **Archive (Crucial)**: If `postProcessAction="Move"`, it moves the files to `processed/`.
5.  **Result**: The folder is now empty (for those files). The next run only finds *new* files.

### 4.2. Handling Structured Data
*   **Parsing**: CSV headers become object keys. JSON Arrays are flattened.
*   **Mapping**: Rename columns (e.g. `CustID` -> `id`) via Schema Config.
*   **Error Handling**:
    *   **Bad Rows**: If a row is malformed, the job can **Skip** it (and log it to `output.errors`) or **Fail Fast** (aborting the job).
    *   **Reporting**: Downstream steps can check `{{step.1.output.errors.length}}` to define failure logic (e.g. "Send Slack Alert").

### 4.3. AI Integration
*   **Images**: Use `Data URI` mode for seamless integration with Multimodal LLMs.
*   **Data**: Pass parsed JSON arrays directly to LLM prompts for summarization (`"Analyze data: {{step.1.output.0.data}}"`)

---

## 5. Implementation Roadmap

### Phase 1: Storage Foundation
*   Implement `ServerStorageService` to handle safe file operations.
*   Create root directory structure.

### Phase 2: Logic & Job
*   Implement `FolderImportJob` handler in `pipeline-step-runner.ts`.
*   Implement `csv-parse` and `glob` logic.
*   Add **Test Import (Dry Run)** API endpoint for the editor.

### Phase 3: UI & Experience
*   Update Job Editor with the new form fields.
*   Create a "File Browser" component for simple upload/view management.
*   Implement **Traceability**: Show "Source File" links in Pipeline Execution History.

---

## 6. Constraints & Limitations
*   **Max File Size**: `read_content` is capped at 100MB (configurable) to prevent Server OOM. Large files must use `list_only` + Stream Processing.
*   **Symlinks**: Strictly disabled.
*   **Timeout**: Users must tune `maxBatchSize` to ensure the job finishes within the HTTP timeout window.
