
# Templates

Templates in Oddjob allow users to create reusable blueprints for pipelines and jobs. This enables valid, standardized pipeline creation without starting from scratch.

## Data Model

Templates are stored in the `pipelineTemplates` table (schema defined in `shared/schema/templates.ts`).

### Key Fields:
- **`name`**: Display name of the template.
- **`description`**: Summary of what the template does.
- **`category`**: Grouping key (e.g., 'Forensics', 'Data Processing').
- **`config`**: A JSON blob containing the `jobs` and `steps` that make up the template.
- **`parameterSchema`**: A JSON schema defining the variables input by the user properly during instantiation (e.g., `{{pipeline.name}}`, `{{input.file}}`).

## Lifecycle & Instantiation

### 1. Template Creation (`Active`)
Templates can be created manually or by "saving" an existing pipeline as a template via the UI.

### 2. Instantiation (Wizard Flow)
When a user wants to use a template, they typically go through the **Template Wizard**.

**Endpoints:**
- **`POST /api/templates/:id/wizard-session`**: 
  - Creates a new "session" by instantiating the pipeline and its initial jobs in **`draft`** status. 
  - Returns the new `pipelineId`.
- **`POST /api/pipelines/:id/promote`**: 
  - Once the user finishes configuring the drafted jobs in the wizard, they "promote" the pipeline.
  - This updates the pipeline and all its associated `draft` jobs to `active` status.

### 3. Draft Status
The `lifecycleStatus` field on both `jobs` and `pipelines` tables manages this flow:
- `'active'`: Normal, visible, executable.
- `'draft'`: Created by the wizard, hidden from main lists, not executable (usually).
- `'archived'`: Soft-deleted (future use).

## usage

The System Copilot can recommend templates to users based on their intent.
- Use `list_templates` (if available via tool) or query the `/api/templates` endpoint to find relevant templates.
- Filter by `category` or search `name`/`description`.
