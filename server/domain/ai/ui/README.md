# UI Module: AI

## Overview

The AI UI module provides the front-end components for managing and monitoring the platform's connections to third-party Large Language Models (LLMs) and other AI services. It offers a centralized place to configure providers, view model usage, and manage the abstraction layer provided by the `ai/core` domain.

## Key Features & Components

- **AI Provider Management:** An interface for adding, editing, and viewing the configuration for different AI providers (e.g., OpenAI, Anthropic, Google Gemini). This includes managing API keys and other credentials securely.
- **Model Catalog:** A view that lists all available models from the configured providers, showing their capabilities, rate limits, and pricing information.
- **Usage Dashboard:** Dashboards and analytics that display token usage, costs, and request latency, broken down by model, agent, or mission. This is crucial for cost control and performance monitoring.
- **Routing Configuration:** UI elements for defining the rules that the `ai-router.service.ts` uses to select the best model for a given task based on criteria like cost, speed, or capability.

## Data Flow

The UI interacts with the `ai` domain's API to fetch provider and model information. It sends configuration updates to the `ai-provider.service.ts` and pulls analytics data aggregated by the `ai/core` services to render the usage dashboards.
