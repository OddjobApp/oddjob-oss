# Strategic Sentinel: Conditional Trigger Dictionary

The Strategic Sentinel parses natural language intent into deterministic boolean logic. This document lists the primary entities and attributes that can be used in conditions.

## 1. Cycle & Operational Context
Conditions related to the current operational cycle status and metadata.

| Attribute | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `cycle.name` | String | Name of the current cycle | `cycle.name == 'Q3 Fleet Ops'` |
| `cycle.priority` | Number | Priority level (0-100) | `cycle.priority > 80` |
| `cycle.status` | Enum | `ACTIVE`, `PAUSED`, `COMPLETED` | `cycle.status == 'ACTIVE'` |
| `cycle.progress` | Percentage | Overall cycle completion | `cycle.progress >= 50` |
| `cycle.drift_detected` | Boolean | If strategic drift has been flagged | `cycle.drift_detected == true` |

## 2. Mission Lifecycle
Events triggered by mission start, completion, or failure.

| Attribute | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `mission.name` | String | Name of the mission template | `mission.name.contains('Extraction')` |
| `mission.status` | Enum | `SUCCESS`, `FAILED`, `CANCELLED` | `mission.status == 'FAILED'` |
| `mission.budget_used` | Currency | Total USD spent so far | `mission.budget_used > 50.00` |
| `mission.reasoning_depth` | Number | System 2 thought depth | `mission.reasoning_depth > 5` |
| `mission.critical_path` | Boolean | If the mission is on the critical path | `mission.critical_path == true` |

## 3. Data & Dataset Integrity
Conditions based on dataset growth, content, or quality.

| Attribute | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `dataset.row_count` | Number | Total records in a dataset | `dataset.row_count > 10000` |
| `dataset.last_updated` | Timestamp | Hours since last update | `dataset.hours_since_update > 24` |
| `dataset.sentiment_score` | Number | Aggregate sentiment (-1 to 1) | `dataset.sentiment < -0.5` |
| `dataset.anomaly_score` | Number | Detected drift/anomaly level | `dataset.anomaly_score > 0.8` |

## 4. External Signals (Integrations)
Triggers based on external platform events.

| Attribute | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `slack.mention` | Boolean | If a specific keyword was mentioned | `slack.text.contains('emergency')` |
| `jira.ticket_status` | Enum | Status of a linked JIRA ticket | `jira.status == 'Blocked'` |
| `github.pr_count` | Number | Open PRs in a repository | `github.open_prs > 5` |

## 5. System & Infrastructure
Performance and health metrics.

| Attribute | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `system.latency_ms` | Number | API or pipeline latency | `system.latency > 2000` |
| `system.error_rate` | Percentage | Error rate in the last 10 mins | `system.error_rate > 0.05` |
| `system.cost_per_token` | Number | Current LLM cost efficiency | `system.cost_per_token > 0.0001` |

## Implementation Note
The evaluator uses a non-eval boolean parser. Complex nesting is supported via logical groups `(condition1 AND condition2) OR (condition3)`. 

To use these in the Command Center, simply type: 
*"Trigger the recovery pipeline if the cycle priority is high and the mission budget exceeds fifty dollars."*
