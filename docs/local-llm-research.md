# Local LLM Research

This document captures local LLM runtimes and recommended model tiers for the Studio installer flow.

## Runtimes to Support

- **Ollama**: Simple installer + model management, good default for one-click setup.
- **LM Studio**: Desktop app with a local server mode; offers OpenAI-compatible API.
- **LocalAI**: Docker-first, OpenAI-compatible API server.
- **vLLM**: High-performance GPU inference, server mode.
- **llama.cpp**: Lightweight CPU/GPU inference with an OpenAI-compatible server.

## Recommended Model Families (Curated)

Use these as defaults in the installer UI, grouped by resource tier:

### Small Tier (8–16 GB RAM / 8–12 GB VRAM)
- Llama 3.1 8B
- Qwen 2.5 7B
- Mistral 7B
- Gemma 2 9B
- Phi-3 Mini

### Medium Tier (16–32 GB RAM / 16–24 GB VRAM)
- Qwen 2.5 14B
- Llama 3.1 70B (quantized)
- Mixtral 8x7B (quantized)

### Large Tier (32+ GB RAM / 24+ GB VRAM)
- Qwen 2.5 Coder 32B
- Llama 3.1 70B

## Installer UX Guidance

- Auto-detect common local runtimes on standard ports.
- Provide a default “Install Ollama + Model” flow for first-run.
- Offer a manual endpoint configuration for advanced users.
- Test endpoint connectivity before saving configuration.

## Sources

- https://lmstudio.ai/docs
- https://developers.llamaindex.ai/typescript/framework/tutorials/local_llm/
- https://developers.llamaindex.ai/typescript/framework/getting_started/installation/

