---
id: story.0158
type: story
title: "AI Content Pipeline — Image & Blog Generation with CDN + Crypto Payments"
status: needs_research
priority: 1
rank: 10
estimate: 3
summary: Spike to validate Flux.1-schnell on Akash GPU, benchmark ComfyUI API, evaluate MinIO vs R2 for object storage, and confirm x402 integration path for content generation endpoints.
outcome: Decision document with benchmarks, architecture confirmation, and P0 task breakdown for image generation service + object storage + CDN.
spec_refs:
assignees: derekg1729
credit:
project: proj.ai-content-cdn
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-11
updated: 2026-03-11
labels: [ai, content, cdn, images, spike]
external_refs:
---

# AI Content Pipeline — Research Spike

## What We Need to Validate

1. **Flux.1-schnell on Akash GPU:** Can we get a ComfyUI + Flux.1-schnell container running on an Akash GPU instance (16GB VRAM)? What's the actual generation latency?
2. **ComfyUI API contract:** Document the REST API surface (POST /prompt, GET /history, WebSocket for progress). Confirm it's stable enough to build an adapter against.
3. **Object storage:** MinIO on Akash vs Cloudflare R2. Benchmark upload/download latency, evaluate cost at 15GB/month scale.
4. **CDN:** Nginx cache in front of MinIO vs Cloudflare CDN in front of R2. Measure TTFB from multiple regions.
5. **x402 integration path:** Confirm `proj.x402-e2e-migration` P0 provides the middleware we need. Identify any gaps.
6. **vLLM for text:** Can we reuse the existing LiteLLM proxy pointed at a vLLM backend, or do we need a new adapter?

## Acceptance Criteria

- [ ] ComfyUI + Flux.1-schnell Docker image builds and generates images
- [ ] Benchmark: images/minute on A4000-equivalent GPU
- [ ] S3 adapter proof-of-concept: upload generated image, retrieve via URL
- [ ] CDN cache hit confirmation
- [ ] Written decision on MinIO vs R2 (or both via port abstraction)
- [ ] P0 task breakdown with estimates

## Validation

- [ ] Decision document written with benchmarks and architecture confirmation
- [ ] P0 task breakdown created with estimates
- [ ] `pnpm check` passes
