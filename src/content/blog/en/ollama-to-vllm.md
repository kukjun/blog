---
title: "From Ollama to vLLM: 4.8× throughput, and why speed was the easy part"
description: "Migrating a multi-model LLM serving stack from Ollama to vLLM. The 4.8× was the headline; the real work was choosing an engine I could operate and proving the quantized models still gave the right answers."
pubDate: 2026-02-09
lang: en
tags: ["LLM serving", "vLLM", "performance", "reliability"]
translationKey: "ollama-to-vllm"
draft: false
---

We were serving three 27–32B open-weight models on 2×48GB GPUs with Ollama. Batch
jobs took **90 minutes**. After migrating to vLLM behind an OpenAI-compatible
gateway, the same jobs finished in **21** — a **4.8× throughput gain** on our
hardware.

But the throughput number is not where the engineering was. The hard parts were
(1) choosing an engine I could *operate*, not the fastest one on a leaderboard,
and (2) proving the quantized models still produced the right answers before I
trusted them in production.

## Where Ollama ran out of room

Ollama got us to production fast — that is its job, and it did it well. Under real
concurrent load it capped out for three structural reasons:

- **No continuous batching.** Requests serialized; the GPU sat idle while requests
  waited in line.
- **No tensor parallelism.** Two NVLink'd GPUs, but a single model couldn't span
  them.
- **Cold start on model switch.** Tens of seconds every time we swapped between the
  three models.

None of these are bugs. They are design choices — Ollama optimizes for "run a model
on a box, easily." We had outgrown that shape.

## Choosing the engine I could trust — not the fastest one

I surveyed ~12 inference servers. On raw throughput the leaders were unambiguous:

| Engine | Throughput (H100, 8B) | vs vLLM |
|---|---|---|
| SGLang | 16,215 tok/s | +29% |
| LMDeploy | 16,132 tok/s | +29% |
| **vLLM** | 12,553 tok/s | baseline |
| llama.cpp | ~35 tok/s | ~−360× |

*(published third-party numbers, not my own)*

vLLM was **not** the fastest. I chose it anyway.

A 29% throughput edge is real — but so is the cost of running an engine with fewer
answers when it breaks at 2am. vLLM had the largest, most mature community: the most
resolved issues, the most battle-tested edge cases, the most reference deployments.
For a small team putting this in front of a product, **operability beat peak
throughput.** Picking the faster-but-thinner engine to save 29% would have traded a
one-time speed win for a standing operational tax. That is a trade I would make the
same way again.

## The real cost: proving the quantized models still worked

The migration's actual bottleneck wasn't configuration — it was **verification.**

Moving from Ollama to vLLM meant moving from GGUF (optimized for CPU offload) to AWQ
(optimized for GPU CUDA kernels). For several models there was no official AWQ build,
only community conversions of unknown fidelity. You cannot swap a quantization format
and hope the outputs are still correct.

So I built an internal benchmark set: the same prompts through the old stack (GGUF)
and the new one (AWQ), outputs compared for equivalence *before* the swap was
trusted. The principle I keep coming back to: **the engine that does the work does
not get to certify its own work** — a separate check decides whether the swap is
safe. That verification step, not the deployment itself, is where most of the time
went.

The final serve command, for reproducibility:

```bash
uv run python -m vllm.entrypoints.openai.api_server \
    --model org/Model-32B-AWQ \
    --tensor-parallel-size 2 \
    --max-model-len 2048 \
    --max-num-seqs 16 \
    --gpu-memory-utilization 0.80 \
    --host 0.0.0.0 --port 8000
```

## The numbers — and what they actually mean

Same 32B-class model, same 4-bit quantization, 5 concurrent requests, 3-run average,
256-token generations. **Internal benchmark, single hardware configuration** — not a
general claim:

| Metric | Ollama | vLLM | Δ |
|---|---|---|---|
| 5 concurrent, wall-clock | 38.9s | 5.7s | 6.8× |
| Mean latency | 23.31s | 6.48s | 3.6× |
| Per-request throughput | 15.0 tok/s | 40.6 tok/s | 2.7× |
| **Total throughput** | 98.6 tok/s | 472.5 tok/s | **4.8×** |

The gap is almost entirely concurrency. Ollama serializes; vLLM overlaps work via
**PagedAttention** (KV cache managed in pages), **continuous batching** (requests
join the running batch dynamically), and **AWQ** kernels (dequantization fused into
the matmul). Note the honest shape of the win: the headline 4.8× is *throughput under
concurrency*; single-request latency improved a more modest 3.6×. Report the metric
that matches the workload, not the largest one on the page.

## Serving several models: a gateway, not a hard-wire

Three models, one contract. I put an **OpenAI-compatible gateway** (LiteLLM proxy) in
front of the fleet:

```
client → gateway (auth) → ├─ vLLM A (GPU 0)  — generation
                          ├─ vLLM B (GPU 1)  — reasoning
                          └─ TEI  (CPU)      — embeddings
```

Clients speak one API (`/v1/chat/completions`). Swapping Ollama's `/api/chat` for the
OpenAI-compatible surface meant client code stopped caring what runs behind the
gateway — the next engine change becomes a config edit, not a client rewrite. **The
interface is the thing you own; the engine behind it is swappable.** That decoupling
outlasts any single serving engine — which is the whole point.

## What I'd tell another engineer

1. **"Good enough, fast" beats "optimal, eventually."** The 29%-faster engine was not
   worth the thinner safety net.
2. **Quantization swaps are a verification problem, not a config problem.** Budget
   more time for proving output fidelity than for writing the deployment.
3. **Put an interface between clients and the engine.** You *will* change engines;
   don't make that a client migration.

It looked like "just an LLM engine." It was really a distributed-systems optimization
wearing an LLM costume.
