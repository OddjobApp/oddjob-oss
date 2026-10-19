# Machine Learning Strategy Prediction

## Overview

An ML-powered system that predicts the optimal reasoning strategy for a given task based on historical performance data. Learns from outcomes to continuously improve predictions.

## How It Works

```
Task Features → Feature Extraction → Strategy Scoring → Prediction
     ↓              ↓                    ↓                ↓
  Description   complexity: 2      chain_of_thought: 0.85  Recommended:
  Complexity    hasData: 0.5       tree_of_thoughts: 0.72   "chain_of_thought"
  Domain        ...                ...                       85% confidence
```

## Features

- **12 Strategy Support**: Predicts from all reasoning strategies
- **Feature-Based Scoring**: Uses 7+ task characteristics
- **Historical Learning**: Improves from actual outcomes
- **Confidence Scoring**: Indicates prediction reliability
- **Automatic Retraining**: Optimizes weights from feedback

## Quick Start

### Get a Prediction

```typescript
import { strategyMLService } from "@domain/agents/core/ml-strategy-predictor";

const prediction = await strategyMLService.predictStrategy(
  {
    description: "Analyze complex sales data and identify trends",
    complexity: "high",
    domain: "analytics",
    hasStructuredData: true,
    requiresCreativity: false,
    hasTimeConstraint: false,
    expectedSteps: 5,
    riskLevel: "medium",
    novelty: "familiar",
    wordCount: 50,
    questionCount: 2,
    keywordDensity: { analyze: 0.2, data: 0.3 }
  },
  "agent-1",        // agent ID
  1                 // organization ID
);

console.log(prediction.strategy);        // "tree_of_thoughts"
console.log(prediction.confidence);      // 0.85
console.log(prediction.reasoning);
// ["Selected based on historical performance",
//  "Well-suited for high-complexity tasks"]
```

### Record Performance for Learning

```typescript
await strategyMLService.recordPerformance({
  strategy: prediction.strategy,
  taskFeatures: prediction.taskFeatures,
  success: true,
  qualityScore: 0.92,
  executionTimeMs: 15000,
  tokenUsage: 2500,
  correctionCount: 1,
  agentId: "agent-1",
  organizationId: 1
});
```

### API Usage

```bash
# Get prediction
curl -X POST /api/ml-strategy/predict \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-1",
    "taskFeatures": {
      "description": "Analyze data",
      "complexity": "high",
      "domain": "analytics",
      "hasStructuredData": true,
      "requiresCreativity": false,
      "hasTimeConstraint": false,
      "expectedSteps": 5,
      "riskLevel": "medium",
      "novelty": "familiar",
      "wordCount": 50,
      "questionCount": 2,
      "keywordDensity": {"analyze": 0.2}
    }
  }'

# Response:
{
  "strategy": "tree_of_thoughts",
  "confidence": 0.85,
  "expectedSuccessRate": 0.88,
  "expectedQuality": 0.82,
  "expectedTimeMs": 12000,
  "reasoning": [
    "Selected based on historical performance",
    "Well-suited for high-complexity tasks"
  ],
  "alternativeStrategies": [
    {"strategy": "chain_of_thought", "confidence": 0.72}
  ]
}
```

## Model Architecture

### Feature Weights

| Feature | Weight | Description |
|---------|--------|-------------|
| complexity | 0.25 | Task difficulty level |
| domain_match | 0.20 | Strategy domain expertise |
| data_availability | 0.15 | Structured data presence |
| creativity_required | 0.15 | Creative thinking needed |
| time_pressure | 0.10 | Time constraints |
| novelty | 0.10 | Familiarity with task type |
| risk_level | 0.05 | Risk tolerance |

### Scoring Algorithm

```
strategy_score = (
  historical_success_rate * 0.4 +
  avg_quality * 0.3 +
  feature_match_score * 0.2 +
  experience_bonus * 0.1
)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ml-strategy/predict` | Get strategy prediction |
| POST | `/api/ml-strategy/batch-predict` | Predict for multiple tasks |
| POST | `/api/ml-strategy/performance` | Record actual performance |
| POST | `/api/ml-strategy/prediction-feedback` | Update with outcome |
| POST | `/api/ml-strategy/retrain` | Retrain model |
| GET | `/api/ml-strategy/metrics` | Get model metrics |
| GET | `/api/ml-strategy/model` | Export model |
| GET | `/api/ml-strategy/top-strategies` | Get top performers |

## Database Schema

### strategy_performance_logs
- Stores historical strategy performance
- Used for training and prediction
- Fields: strategy, taskFeatures, success, qualityScore, etc.

### ml_strategy_predictions
- Logs all predictions made
- Tracks accuracy for model improvement
- Fields: predictedStrategy, confidence, actualSuccess, etc.

### strategy_model_versions
- Tracks model versions
- Stores feature weights and metrics
- Enables model rollback/comparison

## Learning Loop

```
1. Make Prediction → Log prediction with features
2. Execute Strategy → Run with predicted strategy
3. Record Outcome → Log actual performance
4. Update Model → Compare prediction vs actual
5. Retrain Periodically → Optimize feature weights
```

## React Hook

```typescript
import { useStrategyPrediction } from "@/modules/agents/hooks/use-ml-strategy";

const { predict, prediction, isLoading } = useStrategyPrediction();

const handlePredict = async () => {
  const result = await predict({
    agentId: "agent-1",
    taskFeatures: { /* ... */ }
  });
  
  console.log(`Recommended: ${result.strategy}`);
};
```

## Best Practices

1. **Record All Outcomes**: Even failures help the model learn
2. **Wait for Completion**: Record performance after task finishes
3. **Retrain Regularly**: Weekly retraining improves accuracy
4. **Monitor Confidence**: Low confidence = need more data
5. **Review Top Strategies**: Ensure model aligns with expectations

## Model Metrics

Track these metrics to evaluate model health:

- **Accuracy**: % of correct predictions
- **Avg Confidence**: How certain is the model
- **Strategies Evaluated**: Diversity of training data

## Future Improvements

1. **Deep Learning**: Neural network for complex pattern matching
2. **Transfer Learning**: Share models across organizations
3. **Real-time Adaptation**: Update weights during execution
4. **Feature Engineering**: Auto-discover useful features
