# Dataset Management MCP Tools

## Discovery & Retrieval

### list_datasets
List available structured data collections (e.g., Jira Issues, GitHub PRs).
```
list_datasets(
  limit?: number,                   // Max datasets to return (default: 50)
  offset?: number                   // Pagination offset
)
```

### get_dataset_details
Get metadata and schema definition for a specific dataset.
```
get_dataset_details(
  datasetId: number                 // The unique ID of the dataset
)
```
Returns: Dataset name, description, column definitions, and total item count.

### query_dataset
Search for specific items/rows within a dataset.
```
query_dataset(
  datasetId: number,                // Dataset to query
  query?: string,                   // Optional filter term (matches values)
  limit?: number,                   // Max items (default: 20)
  offset?: number,                  // Pagination offset
  filters?: object                  // Column-specific filters { "status": "Done" }
)
```

## Management & Ingestion

### create_dataset
Create a new structured collection.
```
create_dataset(
  name: string,                     // Unique name for the dataset
  description?: string,             // Purpose of data
  schemaMapping?: object,           // JSON column definitions
  validationRules?: object          // Optional data quality rules
)
```

### add_dataset_items
Insert records into a dataset.
```
add_dataset_items(
  datasetId: number,                // Target dataset
  items: Array<object>              // List of records to insert
)
```

## Strategy
- **When to Use**: Use Datasets when looking for structured, repetitive records like "tickets", "issues", "logs", or "audit entries".
- **Planning Mode**: These tools are safe to call during simulation/planning as they are predominantly read-only (except create/add).
- **Persona**: The "Knowledge Engine & Data Explorer" prioritizes these tools for structured research.
