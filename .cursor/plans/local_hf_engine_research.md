# In-depth research: Engine for running HuggingFace models locally

## Summary

- **OpenClaw** uses **Ollama** as the primary local engine (`ollama launch openclaw`); it also supports cloud providers (Anthropic, OpenAI, etc.) and custom OpenAI-compatible endpoints.
- For **Agentron**, **Ollama is a good default** for simple GGUF-based local HF flow. To run **any** HuggingFace model (PyTorch/SafeTensors) locally with one stack, **vLLM** or **TGI** are the right choices; both expose an **OpenAI-compatible `/v1/chat/completions` API**, so the app can treat them like the existing `custom_http` / local provider.
- **Recommendation:** Keep Ollama for the current “Import from HuggingFace (GGUF)+” flow; add **vLLM** (or optionally TGI) as a **second local backend** so users can run HF models by model ID without converting to GGUF. Realization: add a “vLLM” (or “Local HF”) provider that uses the same OpenAI-compatible adapter and a configurable endpoint (e.g. `http://localhost:8000`).

---

## 1. How OpenClaw runs models

- **Docs:** [Ollama – OpenClaw](https://docs.ollama.com/integrations/openclaw), [OpenClaw](https://openclaw.ai/).
- **Local:** OpenClaw uses **Ollama** as the local engine. Setup is `ollama launch openclaw`, which configures the OpenClaw gateway to use Ollama and starts the gateway. Recommended models are Ollama model names (e.g. `qwen3-coder`, `glm-4.7`, `gpt-oss:20b`); context window ≥64k is recommended.
- **Cloud / custom:** OpenClaw also supports Anthropic, OpenAI, Google, and **custom OpenAI-compatible API** providers (via configuration). So it’s “Ollama for local + optional cloud/custom endpoints,” not a custom inference engine.
- **Takeaway:** OpenClaw does **not** run raw HuggingFace PyTorch/SafeTensors models itself; it relies on Ollama (and optionally other APIs). For HF-native local serving, you’d look at vLLM/TGI, which OpenClaw could in theory point at as a custom endpoint.

---

## 2. Engine comparison for HuggingFace models

| Aspect | Ollama | vLLM | TGI (Text Generation Inference) |
|--------|--------|------|----------------------------------|
| **Primary use** | Local GGUF, simple UX | High-perf serving, HF + GGUF | HF-native serving, production |
| **HF model support** | GGUF only (via `ollama pull hf.co/...`) | HF model IDs + local paths; PyTorch/SafeTensors | HF model IDs + local; PyTorch/SafeTensors |
| **API** | Own API + OpenAI-compatible | **OpenAI-compatible** (`/v1/chat/completions`, etc.) | **OpenAI-compatible** (`/v1/chat/completions`) + `/generate`, `/generate_stream` |
| **Default port** | 11434 | 8000 | 8080 (often 80 in container) |
| **Deployment** | Single binary, desktop-friendly | Python, Docker; GPU typical | Docker / launcher; GPU typical |
| **Performance** | Good for single-user local | Very high throughput, PagedAttention, continuous batching | High throughput; TGI can use vLLM/TRT as backend (multi-backend) |
| **Ease of “run any HF model”** | No (GGUF only) | Yes: `vllm serve org/model` | Yes: `--model-id org/model` or Docker with `MODEL_ID` |
| **Chat template** | Handled by Ollama | From model repo or `--chat-template` | From model repo |

- **vLLM** ([docs](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html)): Loads HF models by ID or path; uses `config.json` and `model_type`; OpenAI-compatible server; supports extra params (e.g. `top_k`) via `extra_body`. Good when you want one server and “any HF model” by ID.
- **TGI** ([consuming TGI](https://huggingface.co/docs/text-generation-inference/en/basic_tutorials/consuming_tgi)): HuggingFace’s server; `/v1/chat/completions` with `model: "tgi"` (or the loaded model ID); can be run with `--model-id MODEL_HUB_ID` or Docker; supports vLLM/TRT as backends. Good when you want HF-first tooling and optional multi-backend.
- **Ollama**: Best for “pull and run” GGUF; no support for raw PyTorch/SafeTensors HF models.

---

## 3. What the app already has

- **Runtime** ([packages/runtime/src/llm/](packages/runtime/src/llm/)):
  - **Local provider** → Ollama at `localhost:11434`, via **OpenAI-compatible** chat.
  - **custom_http** → Generic OpenAI-compatible endpoint (any URL).
  - **openai-compatible.ts** → Single implementation: `POST {endpoint}/v1/chat/completions` with `model`, `messages`, etc.
- **Detect** ([packages/runtime/src/llm/installer/detect.ts](packages/runtime/src/llm/installer/detect.ts)): Already probes **vLLM** at `http://localhost:8000` (and Ollama, LM Studio, LocalAI, llama.cpp).
- **Types** ([packages/core/src/types/llm.ts](packages/core/src/types/llm.ts)): `LLMProvider` = `"local" | "openai" | ... | "huggingface" | "custom_http"`. No dedicated `"vllm"` or `"tgi"` yet; they can be used via **custom_http** (endpoint + model).

So: **any engine that speaks OpenAI `/v1/chat/completions` can be integrated with the existing adapter.** vLLM and TGI both do.

---

## 4. Recommendation for Agentron

- **Keep Ollama** for the current “Local Models” flow: search HF → Import (GGUF) → pull → run. No change to the “engine” for that path.
- **Add a first-class path for “run HF models locally without GGUF”:**
  - **Option A – Use existing `custom_http`:** Document that users can run vLLM (or TGI) and add a **Custom HTTP** provider with endpoint `http://localhost:8000` (vLLM) or `http://localhost:8080` (TGI), model = HF model ID (for vLLM) or `tgi` (for TGI single-model). No code change; only docs/UX.
  - **Option B – Add a dedicated “vLLM” (or “Local HF”) provider:** New provider type (e.g. `vllm` or `local_hf`) that defaults endpoint to `http://localhost:8000`, uses the same `openAICompatibleChat` adapter, and appears in Settings/Agent LLM with a short description (“Run HuggingFace models via vLLM”). Model field = HF model ID. This makes the “run any HF model locally” path obvious and consistent (e.g. detect vLLM like the installer already does).
- **Choosing vLLM vs TGI in the app:** Both are OpenAI-compatible. vLLM is often easier to run locally (e.g. `pip install vllm && vllm serve meta-llama/Llama-3.2-1B`). TGI is HF-native and supports multi-backend (including vLLM). For “one engine to recommend in the app,” **vLLM** is a good default (single server, HF model ID, port 8000); TGI can be supported the same way via custom_http or a second provider.

---

## 5. How to realize it

### 5.1 Minimal: Document custom_http for vLLM/TGI

- In Settings → LLM or Local Models (or a small “Run HF models locally” doc):
  - **vLLM:** Install vLLM, run e.g. `vllm serve meta-llama/Llama-3.2-1B --dtype auto`. Add **Custom HTTP** provider: endpoint `http://localhost:8000`, model `meta-llama/Llama-3.2-1B`.
  - **TGI:** Run TGI with `--model-id <HF_ID>` on port 8080. Add **Custom HTTP**: endpoint `http://localhost:8080`, model `tgi` (or the model ID if TGI exposes it).

No backend or provider type changes; only UX/docs.

### 5.2 First-class vLLM provider (recommended)

1. **Core types** ([packages/core/src/types/llm.ts](packages/core/src/types/llm.ts))  
   - Add `"vllm"` to `LLMProvider`.

2. **Runtime provider** ([packages/runtime/src/llm/providers/](packages/runtime/src/llm/providers/))  
   - New file `vllm.ts` (or reuse a generic name like `openai-compatible-local.ts`):
     - `provider: "vllm"`.
     - `endpoint = config.endpoint ?? "http://localhost:8000"`.
     - Call `openAICompatibleChat(endpoint, config, request, {})`.
   - Register in [packages/runtime/src/llm/manager.ts](packages/runtime/src/llm/manager.ts).

3. **Rate limits** ([packages/runtime/src/llm/rate-limits.ts](packages/runtime/src/llm/rate-limits.ts))  
   - Add `vllm` with similar limits to `local` (e.g. no TPM cap or high limit).

4. **UI**
   - **Settings → LLM:** In provider dropdown, add “vLLM (local HF)”. Endpoint default `http://localhost:8000`; model = free-text (HF model ID). Optional: “Detect” button that uses existing `detectLocalRuntimes()` and pre-fills endpoint if vLLM is found.
   - **Agent LLM:** Include vLLM in provider list; model = HF model ID.
   - **Local Models page (optional):** Add a short section “Using vLLM” that links to vLLM install and points to adding a vLLM provider in Settings.

5. **Catalog** ([packages/runtime/src/llm/models/catalog.ts](packages/runtime/src/llm/models/catalog.ts))  
   - `vllm: []` (discovery by search/free-text, like `huggingface`).

6. **Installer/detect**  
   - Already detects vLLM at 8000; optional: in Settings when user selects vLLM, call detect and suggest the endpoint.

### 5.3 Optional: TGI as another provider

- Same pattern: add `"tgi"` to `LLMProvider`, provider adapter with default endpoint `http://localhost:8080`, register and add to UI. Model = `tgi` or the loaded model ID depending on TGI version.

### 5.4 Optional: “Local HF” search → use vLLM

- On Local Models (or a “Local HF” tab), keep HF search. For each result, two actions: **Import to Ollama** (GGUF only, current flow) and **Use with vLLM** (if vLLM is configured): set model to HF ID and optionally open LLM Settings to add/select vLLM provider. No new engine; just UX that ties search to the vLLM provider.

---

## 6. References

- OpenClaw + Ollama: https://docs.ollama.com/integrations/openclaw  
- vLLM OpenAI-compatible server: https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html  
- vLLM HuggingFace integration: https://docs.vllm.ai/en/latest/design/huggingface_integration/  
- TGI consuming (OpenAI compatibility): https://huggingface.co/docs/text-generation-inference/en/basic_tutorials/consuming_tgi  
- TGI multi-backend (vLLM/TRT): https://huggingface.co/blog/tgi-multi-backend  
- vLLM vs TGI comparison: https://www.inferless.com/learn/vllm-vs-tgi-the-ultimate-comparison-for-speed-scalability-and-llm-performance  

---

## 7. Conclusion

- **OpenClaw** uses **Ollama** for local models and supports cloud + custom OpenAI-compatible endpoints.
- For **Agentron**, **Ollama remains the right choice** for the existing “Import from HuggingFace (GGUF)” flow. For running **any** HuggingFace model locally (no GGUF requirement), **vLLM** (or TGI) is the right engine; both expose OpenAI-compatible APIs.
- **Realization:** Add a **vLLM** provider (and optionally TGI) that reuses the existing OpenAI-compatible chat adapter and default endpoints (8000 / 8080). No change to Ollama flow; users get a clear “run HF models locally” path with minimal code (new provider type + UI entries + optional detect).
