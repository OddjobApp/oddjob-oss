# Data Flow Patterns

How data moves between features in common automation scenarios.

## API Integration Pattern

```
┌──────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────────┐
│ External │───▶│  CURL Job   │───▶│ Transformer │───▶│   Dataset    │
│   API    │    │ (fetch)     │    │  (extract)  │    │  (store)     │
└──────────┘    └─────────────┘    └─────────────┘    └──────────────┘
                      │
                      ▼
               ┌─────────────┐
               │   KG Node   │
               │ (entity)    │
               └─────────────┘
```

### Data Passed:
1. **CURL → Transformer**: `{{steps.0.output}}` (raw API response)
2. **Transformer → Dataset**: Flattened records
3. **CURL → KG**: Entity extraction

---

## Batch Processing Pattern

```
┌──────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────────┐
│ External │───▶│  CURL Job   │───▶│  Iterator   │───▶│  Per-Item    │
│   API    │    │ (get list)  │    │ (loop)      │    │    Job       │
└──────────┘    └─────────────┘    └─────────────┘    └──────────────┘
```

### Data Passed:
1. **CURL → Iterator**: `{{steps.0.output.items}}` (array)
2. **Iterator → Per-Item Job**: `{{item}}` (single item)

---

## JIRA Integration Pattern

```
┌──────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────────┐
│  JIRA    │───▶│  CURL Job   │───▶│ Transformer │───▶│     KG       │
│  Cloud   │    │  (JQL)      │    │ (extract)   │    │  (Tickets)   │
└──────────┘    └─────────────┘    └─────────────┘    └──────────────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │   Slack      │
                                   │ Notification │
                                   └──────────────┘
```

### Configuration:
- CURL uses JIRA credential for auth
- Transformer extracts: key, summary, status, assignee
- KG creates Ticket entities with RELATED_TO relationships
- Decision node routes to Slack if high-priority issues found

---

## Scheduled Execution Pattern

```
┌──────────┐    ┌──────────────┐    ┌─────────────┐
│ Schedule │───▶│ Scheduled Job│───▶│  Pipeline   │
│ (timing) │    │   (link)     │    │ (workflow)  │
└──────────┘    └──────────────┘    └─────────────┘
                       │
                       ▼
                ┌─────────────┐
                │   Alert     │
                │ (on failure)│
                └─────────────┘
```

### Trigger Types:
- **Schedule**: Time-based (cron, daily, etc.)
- **Webhook**: External HTTP trigger
- **API**: Programmatic trigger
- **Manual**: User-initiated

---

## Error Handling Pattern

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    Job      │───▶│  Decision   │───▶│Success Path │
│ (execute)   │    │(check error)│    └─────────────┘
└─────────────┘    └─────────────┘
                          │
                          ▼ (on error)
                   ┌─────────────┐    ┌─────────────┐
                   │   Slack     │───▶│   Retry     │
                   │  (notify)   │    │   Step      │
                   └─────────────┘    └─────────────┘
```

### Decision Conditions:
- `{{steps.0.error}}` - Check if error exists
- `{{steps.0.output.status}}` - Check status code
