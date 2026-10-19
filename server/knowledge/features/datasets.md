# Datasets Feature

## Overview
Datasets are structured data collections used for training, analysis, or as job outputs.

## Dataset Types

| Type | Purpose |
|------|---------|
| Generic | General data storage |
| Fine-tuning | AI model training data |
| Output | Job output collection |

## Schema Definition

Datasets have defined schemas with fields:
```json
{
  "fields": [
    {"name": "id", "type": "string", "required": true},
    {"name": "content", "type": "text", "required": true},
    {"name": "category", "type": "string", "required": false}
  ]
}
```

## Field Types
- `string`: Short text
- `text`: Long text
- `number`: Numeric values
- `boolean`: True/false
- `date`: Date values
- `json`: Nested JSON objects

## Job Output Integration

Jobs can write results to datasets:
```json
{
  "type": "curl",
  "outputDatasetId": 5,
  "config": {...}
}
```

Results are flattened and stored according to dataset schema.

## Use Cases

### Data Collection
1. Create dataset with schema
2. Configure job to output to dataset
3. Run job to populate dataset

### Fine-Tuning Preparation
1. Create fine-tuning dataset
2. Add training examples
3. Export for model training

## User Help Scenarios

| Scenario | Response |
|----------|----------|
| "Store job output" | Set outputDatasetId on job |
| "Create training data" | Create fine-tuning dataset with examples |
| "View collected data" | Navigate to dataset detail page |
