# Multi-Model LLM Router

Intelligent routing service for managing multiple AI providers with cost optimization, fallback chains, and performance tracking.

---

## Overview

The LLM Router provides a unified interface for interacting with multiple AI providers (OpenAI, Anthropic, Google, Azure) while optimizing for cost, quality, or speed. It automatically handles failover, tracks usage, and maintains health monitoring for each provider.

---

## Features

### Multi-Provider Support
- **OpenAI** (GPT-4, GPT-4 Turbo, GPT-3.5 Turbo)
- **Anthropic** (Claude 3 Opus, Sonnet, Haiku)
- **Google** (Gemini Pro, Gemini Ultra)
- **Azure OpenAI** (GPT-4, GPT-3.5)
- **Extensible** - Add custom providers via adapter interface

### Intelligent Routing
- **Cost Optimization** - Select cheapest capable model
- **Quality Prioritization** - Select highest quality model
- **Speed Priority** - Select fastest model
- **Capability Matching** - Match requirements to model features
- **Fallback Chains** - Automatic failover on failure

### Health Monitoring
- **Success Rate Tracking** - Per-provider success metrics
- **Latency Monitoring** - Response time tracking
- **Circuit Breaker** - Auto-disable failing providers
- **Automatic Recovery** - Retry failed providers after cooldown

### Cost Management
- **Per-Request Cost Calculation** - Track spend per job
- **Daily Aggregation** - Rollup costs for dashboards
- **Budget Alerts** - Warn on high spend
- **Token Usage Tracking** - Integrates with existing token tracking

---

## Installation

### 1. Environment Variables

```env
# Optional: Default API keys (per-organization keys stored in DB)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
```

### 2. Database Migration

```bash
# Run schema
psql -d oddjob < server/migrations/003_llm_router.sql
```

### 3. Register Routes

```typescript
// server/app.ts
import llmRouterRoutes from "./routes/ai/llm-router.route.js";

app.use("/api/ai", llmRouterRoutes);
```

### 4. Initialize Router

The router auto-initializes when the module loads. Provider adapters are registered automatically.

---

## API Endpoints

### Chat Completions

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai/chat/completions` | Unified chat completion endpoint |

### Provider Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai/providers` | List configured providers |
| POST | `/api/ai/providers` | Add new provider |
| PUT | `/api/ai/providers/:id` | Update provider |
| DELETE | `/api/ai/providers/:id` | Deactivate provider |
| GET | `/api/ai/providers/:id/health` | Get provider health |

### Model Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai/models` | List available models |
| POST | `/api/ai/models` | Add new model |
| PUT | `/api/ai/models/:id` | Update model |
| DELETE | `/api/ai/models/:id` | Deactivate model |

### Routing Rules

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai/routing/rules` | List routing rules |
| POST | `/api/ai/routing/rules` | Create routing rule |
| PUT | `/api/ai/routing/rules/:id` | Update routing rule |
| DELETE | `/api/ai/routing/rules/:id` | Delete routing rule |

### Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai/analytics` | Get routing statistics |
| GET | `/api/ai/logs` | Get request logs |
| POST | `/api/ai/cost-estimate` | Estimate request cost |

---

## Usage Examples

### Basic Completion

```typescript
import { llmRouterService } from "@domain/ai/core/llm-router.service.js";

// Simple request - automatically selects best model
const response = await llmRouterService.complete({
    messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "What is the capital of France?" }
    ],
    temperature: 0.7,
    maxTokens: 150,
}, organizationId, jobId, jobRunId);

console.log(response.content); // "The capital of France is Paris."
console.log(response.provider); // "openai"
console.log(response.model); // "gpt-3.5-turbo"
console.log(response.usage.cost); // 0.00015
```

### Routing Strategies

```typescript
// Optimize for cost
const cheapResponse = await llmRouterService.complete({
    messages: [{ role: "user", content: "Summarize this text." }],
    routingStrategy: "cost",
});

// Optimize for quality
const qualityResponse = await llmRouterService.complete({
    messages: [{ role: "user", content: "Write a complex algorithm." }],
    routingStrategy: "quality",
});

// Optimize for speed
const fastResponse = await llmRouterService.complete({
    messages: [{ role: "user", content: "Quick check needed." }],
    routingStrategy: "speed",
});
```

### Capability Matching

```typescript
// Request vision capability
const visionResponse = await llmRouterService.complete({
    messages: [
        { 
            role: "user", 
            content: "Describe this image: [image data]",
            // Or use actual image data in proper format
        }
    ],
    capabilities: ["vision"], // Requires vision-capable model
});

// Request code generation
const codeResponse = await llmRouterService.complete({
    messages: [{ role: "user", content: "Write a Python function." }],
    capabilities: ["code"],
});

// Multiple capabilities
const complexResponse = await llmRouterService.complete({
    messages: [{ role: "user", content: "Analyze this code and suggest improvements." }],
    capabilities: ["code", "reasoning"],
});
```

### Specific Model Selection

```typescript
// Use specific model
const gpt4Response = await llmRouterService.complete({
    messages: [{ role: "user", content: "Complex reasoning task." }],
    preferredProvider: "openai",
    preferredModel: "gpt-4",
});

// Use Claude
const claudeResponse = await llmRouterService.complete({
    messages: [{ role: "user", content: "Creative writing task." }],
    preferredProvider: "anthropic",
    preferredModel: "claude-3-opus-20240229",
});
```

### Fallback Handling

```typescript
// Automatic fallback enabled by default
const response = await llmRouterService.complete({
    messages: [{ role: "user", content: "Hello" }],
    fallbackEnabled: true, // Default
});

// Disable fallback for strict requirements
const strictResponse = await llmRouterService.complete({
    messages: [{ role: "user", content: "Critical operation." }],
    fallbackEnabled: false, // Fail if primary fails
});
```

### Cost Estimation

```typescript
// Get cost estimate before making request
const estimate = await fetch("/api/ai/cost-estimate", {
    method: "POST",
    body: JSON.stringify({
        model: "gpt-4",
        inputTokens: 2000,
        outputTokens: 500,
    }),
}).then(r => r.json());

console.log(estimate); // { inputCost: 0.06, outputCost: 0.03, totalCost: 0.09 }
```

---

## Provider Configuration

### Adding a Provider

```typescript
// Add OpenAI provider
const response = await fetch("/api/ai/providers", {
    method: "POST",
    body: JSON.stringify({
        name: "openai",
        displayName: "OpenAI",
        apiKey: "sk-...",
        supportsStreaming: true,
        supportsVision: true,
        supportsFunctions: true,
        supportsJsonMode: true,
        maxRequestsPerMinute: 60,
        maxTokensPerMinute: 100000,
        defaultInputCostPer1k: 0.03,
        defaultOutputCostPer1k: 0.06,
        priority: 100,
    }),
});

// Add Azure OpenAI
const azureResponse = await fetch("/api/ai/providers", {
    method: "POST",
    body: JSON.stringify({
        name: "azure",
        displayName: "Azure OpenAI",
        apiKey: "...",
        apiEndpoint: "https://your-resource.openai.azure.com/",
        supportsStreaming: true,
        supportsVision: false,
        defaultInputCostPer1k: 0.01,
        defaultOutputCostPer1k: 0.03,
        priority: 200,
    }),
});
```

### Adding Models

```typescript
// Add GPT-4 model
const response = await fetch("/api/ai/models", {
    method: "POST",
    body: JSON.stringify({
        providerId: 1,
        modelId: "gpt-4",
        displayName: "GPT-4",
        contextWindow: 8192,
        maxOutputTokens: 4096,
        supportsStreaming: true,
        supportsVision: false,
        supportsFunctions: true,
        supportsJsonMode: true,
        qualityScore: 95,
        speedScore: 70,
        costScore: 60,
        inputCostPer1k: 0.03,
        outputCostPer1k: 0.06,
        capabilities: ["code", "reasoning", "analysis"],
        isDefault: false,
    }),
});
```

---

## Routing Rules

### Creating Rules

```typescript
// Create rule for high-quality code tasks
const rule = await fetch("/api/ai/routing/rules", {
    method: "POST",
    body: JSON.stringify({
        name: "Code Quality Priority",
        description: "Use best models for code generation",
        priority: 100,
        requiredCapabilities: ["code"],
        minQualityScore: 90,
        preferredProviders: ["openai", "anthropic"],
        fallbackEnabled: true,
        maxRetries: 3,
    }),
});

// Create rule for cost-sensitive operations
const costRule = await fetch("/api/ai/routing/rules", {
    method: "POST",
    body: JSON.stringify({
        name: "Cost Optimization",
        description: "Minimize cost for simple tasks",
        priority: 200,
        maxCostPer1k: 0.01,
        fallbackEnabled: true,
    }),
});
```

---

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `llm_providers` | Provider configurations and credentials |
| `llm_models` | Available models with capabilities and pricing |
| `llm_routing_rules` | Custom routing logic rules |
| `llm_router_logs` | Request history and performance data |
| `llm_provider_health` | Provider health monitoring |

### Key Fields

**llm_providers:**
- `name` - Provider identifier (openai, anthropic, google, azure)
- `api_key` - Encrypted API key
- `priority` - Lower = higher priority in routing
- `is_active` - Enable/disable provider
- `supports_*` - Feature flags

**llm_models:**
- `model_id` - Provider-specific model ID
- `context_window` - Max context tokens
- `quality_score` - Quality rating (0-100)
- `speed_score` - Speed rating (0-100)
- `cost_score` - Cost efficiency (0-100)
- `capabilities` - JSON array of capabilities

---

## Pricing Reference

### OpenAI
| Model | Input/1K | Output/1K |
|-------|----------|-----------|
| GPT-4 | $0.03 | $0.06 |
| GPT-4 Turbo | $0.01 | $0.03 |
| GPT-3.5 Turbo | $0.0005 | $0.0015 |

### Anthropic
| Model | Input/1K | Output/1K |
|-------|----------|-----------|
| Claude 3 Opus | $0.015 | $0.075 |
| Claude 3 Sonnet | $0.003 | $0.015 |
| Claude 3 Haiku | $0.00025 | $0.00125 |

### Google
| Model | Input/1K | Output/1K |
|-------|----------|-----------|
| Gemini Pro | $0.000125 | $0.000375 |
| Gemini Ultra | $0.00125 | $0.00375 |

---

## Health Monitoring

### Circuit Breaker

Providers are automatically disabled after 5 consecutive failures:

```typescript
// Check provider health
const health = await fetch("/api/ai/providers/1/health").then(r => r.json());

// Response:
{
    providerId: 1,
    status: "healthy", // healthy, degraded, down
    successRate: 98.5,
    avgLatencyMs: 450,
    consecutiveFailures: 0,
    circuitOpen: false
}
```

### Automatic Recovery

Disabled providers are automatically retried after 5-minute cooldown.

---

## Testing

```bash
# Run LLM Router tests
npm test -- tests/integrations/llm-router.test.ts
```

### Manual Testing

```bash
# Test chat completion
curl -X POST https://your-app.com/api/ai/chat/completions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "routingStrategy": "cost"
  }'

# Test cost estimation
curl -X POST https://your-app.com/api/ai/cost-estimate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "inputTokens": 2000,
    "outputTokens": 500
  }'
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No models available" | Check providers are configured and active |
| "Provider not found" | Verify adapter is registered for provider name |
| High latency | Check provider health, may need fallback |
| Circuit breaker open | Wait 5 minutes for auto-recovery or check provider status |
| Cost higher than expected | Review routing rules and strategy selection |

---

## Best Practices

1. **Use capability matching** for specialized tasks
2. **Enable fallbacks** for critical operations
3. **Monitor health dashboard** regularly
4. **Set quality thresholds** for important tasks
5. **Use cost optimization** for high-volume operations
6. **Track usage** via analytics endpoint
7. **Configure multiple providers** for redundancy

---

## Extending with Custom Providers

```typescript
// Register custom adapter
llmRouterService.registerAdapter("custom", {
    name: "custom",
    complete: async (request, model) => {
        // Your custom API call
        const response = await fetch("https://your-api.com/complete", {
            method: "POST",
            body: JSON.stringify({
                model: model.modelId,
                messages: request.messages,
            }),
        });
        
        const data = await response.json();
        
        return {
            content: data.text,
            model: model.modelId,
            provider: "custom",
            usage: {
                inputTokens: data.inputTokens,
                outputTokens: data.outputTokens,
                totalTokens: data.totalTokens,
                cost: calculateCost(data, model),
            },
            latency: { totalMs: 0 },
        };
    },
    stream: async (request, model, onChunk) => {
        // Streaming implementation
    },
});
```

---

For questions or issues, refer to the service implementation in:
- `@domain/ai/core/llm-router.service.ts`
- `@server/routes/ai/llm-router.route.ts`
