# GPU Acceleration & Hardware Offloading Guide for Local SLMs

This guide explains how to enable GPU acceleration for local Small Language Models (SLMs) in the Oddjob platform via Ollama.

## Overview
By default, Local SLM execution runs via Ollama (`http://localhost:11434`). Enabling GPU acceleration drastically reduces local inference latency from **20–60s on CPU** down to **< 500ms on GPU**.

---

## 1. Quantized Models
Oddjob defaults to quantized `q4_K_M` 4-bit models for optimal VRAM footprint and CPU/GPU offload efficiency:

- **Classification / Summarization / Extraction**: `llama3.2:1b-instruct-q4_K_M`
- **Reasoning**: `deepseek-r1:1.5b-q4_K_M`

To pull these models locally:
```bash
ollama pull llama3.2:1b-instruct-q4_K_M
ollama pull deepseek-r1:1.5b-q4_K_M
```

---

## 2. Hardware Setup

### NVIDIA CUDA (Windows / Linux)
1. Ensure the NVIDIA CUDA Toolkit (v12.0+) and driver are installed.
2. Verify GPU detection by running:
   ```bash
   nvidia-smi
   ```
3. Ollama automatically detects CUDA devices. Set the environment variable to force all layers onto the GPU:
   ```env
   OLLAMA_NUM_GPU=99
   ```

### Apple Silicon (Metal / MPS)
Apple Silicon (M1/M2/M3/M4) supports unified memory GPU offloading out of the box. No manual CUDA setup is required.

---

## 3. Verifying GPU Offload

Run a model query and inspect active process memory via Ollama:

```bash
ollama ps
```

Under the **PROCESSOR** column:
- `100% GPU`: Full acceleration (ideal)
- `100% CPU`: Fallback mode (verify CUDA drivers and `OLLAMA_NUM_GPU`)
- `50% CPU / 50% GPU`: Partial offload (VRAM constrained)

---

## 4. Platform Environment Configuration

In `.env` or system environment:

```env
# Enable maximum GPU layer offloading for local SLMs
OLLAMA_NUM_GPU=99

# Host configuration
OLLAMA_HOST=http://localhost:11434
```
