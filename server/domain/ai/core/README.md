
# AI Core Services

This module is the central gateway for all interactions with third-party AI models and services. It provides a universal abstraction layer that allows the rest of the Oddjob platform to interact with different AI providers (OpenAI, Anthropic, Google, etc.) through a single, consistent interface.

## Core Responsibilities

### 1. Provider Abstraction
- **`providers/`**: This directory contains the specific client implementations for each supported AI provider. Each client adheres to a common `LLMClient` interface.
- **`ai-client.service.ts`**: The `AIClientFactory` in this service is the main entry point. It takes an AI configuration and returns the appropriate client instance, hiding the provider-specific implementation details from the rest of the application.

### 2. Model Routing and Resilience
- **`llm-router.service.ts`**: A key piece of strategic infrastructure, this service can dynamically route a request to the best (or most cost-effective) model for a given task. This allows us to avoid being locked into a single provider.
- **`resilience-proxy.ts`**: Provides an automatic retry and failover mechanism. If a request to one provider fails, it can automatically re-route it to a different provider, ensuring system stability.

### 3. Specialized AI Capabilities
- **`embedding-service.ts`**: Provides a unified service for creating vector embeddings for text, used for semantic search and long-term memory.
- **`image-synthesis.service.ts`**: An abstraction layer for interacting with image generation models like DALL-E or Midjourney.
- **`fine-tuning.service.ts`**: Contains the logic for managing and executing fine-tuning jobs to create custom models.

### 4. Cost Management and Caching
- **`cost-registry.ts`**: A service that tracks the cost of each model, allowing for cost estimation and budget management.
- **`semantic-cache.service.ts`**: Provides a cache for LLM responses. If the same request is made twice, the cached response can be returned instantly, reducing both latency and cost.
