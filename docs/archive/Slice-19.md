
# Slice 19: Pipeline Form and Job Picker UI

This slice implements the user interface (UI) components for listing, creating, and editing Pipelines, leveraging the backend structure established in Slice 18. This is the first tangible feature for the end user.

---

## 1. New Components and Routing

| Component          | Purpose                                                                 | Location in Code |
|--------------------|-------------------------------------------------------------------------|------------------|
| **PipelineListPage** | Lists all Pipelines, supporting searching, sorting, and actions (Edit/Delete) | New Component |
| **PipelineForm**     | The main form for Pipeline CRUD operations, including a dynamic step manager | New Component |
| **PipelinePage**     | Acts as the router for `/dashboard/pipelines/:id` and `/dashboard/pipelines/new` routes | New Component |

---

## 2. Pipeline Form (PipelineForm) Details

This is the core configuration component, based on the `PipelineCreateSchema`.

- **General Details**: Set Pipeline Name, Description, Active Status (Switch), and Trigger Type (Schedule or External).
- **Step Manager**: Manages the dynamic array of steps.
  - **Add/Remove Steps**: Buttons allow adding new steps and removing existing ones.
  - **Job Selection**: Each step features a Select component populated dynamically with available Job Definitions using `api.getJobs()`.
  - **Conditional Run**: Choose between Always Run or Only if Step N Succeeded.
  - **Ordering**: Execution Order is maintained automatically and is read only.
- **Validation**: Uses `zodResolver` with `PipelineCreateSchema`, ensuring at least one step is configured.

---

## 3. User Experience (UX) Enhancements

Enhance context in existing components to reflect the new entity.

- **Job List Page (JobListPage)**
  - Add a **Pipeline Usage** column to the DataTable.
  - Users can immediately see if a Job is part of an active Pipeline. This is crucial context before editing or deleting the Job.

- **Pipeline List Page**
  - Display Name, number of Steps, Trigger Type, Active Status, and Creator.
  - Provides a central overview of all orchestrated workflows.

---

## 4. Notes

- This slice depends on the data model and API scaffolding from Slice 18.
- The UI should respect authorization constraints and any row level security enforced in the API.
