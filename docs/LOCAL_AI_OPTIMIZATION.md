# Local AI Optimization Guide (RTX 5070)

This guide provides instructions on how to maximize the performance of local models (Ollama, DeepSeek) using the Blackwell architecture (RTX 5070) and Flash Attention 2.

## Prerequisites

- **NVIDIA Driver**: 565.xx or higher (Blackwell recommended).
- **Ollama**: v0.5.7 or higher.
- **Hardware**: RTX 5070 (12GB/16GB VRAM).

## Environment Variables

To ensure Ollama utilizes the RTX 5070 effectively, set the following environment variables on your host machine:

```powershell
# Windows PowerShell
$env:OLLAMA_FLASH_ATTENTION="1"
$env:OLLAMA_KV_CACHE_TYPE="f16" # Maintain high precision for DeepSeek reasoning
$env:OLLAMA_NUM_PARALLEL="4"    # Leverage Blackwell parallelism for multiple agent steps
```

## System Confirmation

Start Ollama and monitor the logs during initial prompt ingestion:

1. Look for `[CUDA] Flash Attention enabled` in the console output.
2. Monitor GPU utilization using `nvidia-smi -l 1`. Prompt ingestion (reading your history) should show a sharp spike in Compute usage but very fast completion.

## Model Recommendations

For the RTX 5070, we recommend the following DeepSeek-R1 variants:

- `deepseek-r1:32b` (8-bit quantization) - High intelligence, fits well in VRAM.
- `deepseek-r1:14b` (K_M quantization) - Extremely fast for autonomous agent loops.

## Troubleshooting

If you see `context limit reached` errors:
- We have configured the client to default to **32,768 tokens**. 
- If you need more, update the `numCtx` property in your AI Credential metadata in the Oddjob settings.
