# 🔗 Slice 23: Event-Driven Triggers (Webhooks)

This slice extends the scheduling platform's capabilities beyond time-based triggers by introducing Event-Driven Triggers via Webhooks. This allows external systems (like Git, CRM, or Monitoring tools) to securely initiate a Scheduled Job or a Pipeline using an API key/secret.

1. Schema and Model Updates

The schemas for both executable entities are modified to support the new triggering mechanism.

2. Mock API Endpoint (api.triggerWebhook)

A new mock API endpoint is added to simulate the external system interacting with the scheduler.

3. UI and Configuration Impact

The primary configuration forms are updated to expose the new trigger options.