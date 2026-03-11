---
id: proj.ai-content-cdn
type: project
primary_charter:
title: "AI-Generated Content Pipeline — Images & Blog Posts with CDN + Crypto Payments"
state: Active
priority: 1
estimate: 4
summary: End-to-end pipeline for AI-generated images and blog posts, served via CDN, paid for with crypto (USDC on Base). 100% OSS inference stack (Flux for images, vLLM for text), S3-compatible storage with CDN edge delivery.
outcome: Nodes autonomously generate, store, and serve AI images and blog posts behind x402 micropayments, with all inference running on self-hosted OSS models deployed to Akash GPU instances.
assignees: derekg1729
created: 2026-03-11
updated: 2026-03-11
labels: [ai, content, cdn, crypto, images, blog]
---

# AI-Generated Content Pipeline — Images & Blog Posts with CDN + Crypto Payments

> Story: `story.0158`

## Goal

Build a Pareto-optimal content generation pipeline for Cogni nodes. The 20% effort that delivers 80% of the value: self-hosted OSS image generation (Flux.1-schnell via ComfyUI) and text generation (vLLM serving open-weight LLMs), stored in S3-compatible object storage with CDN edge delivery, monetized through x402 USDC micropayments on Base. Every component is OSS or crypto-native. No vendor lock-in.

**Key Pareto decisions:**

- **Images:** Flux.1-schnell (4-8 step generation, ~2s on A4000) > SDXL/SD3 for quality-per-compute
- **Text:** vLLM + Qwen 2.5 72B (AWQ 4-bit) for quality, or 7B for cost. OpenAI-compatible API = zero custom client code
- **Storage:** S3-compatible (MinIO self-hosted on Akash, or Cloudflare R2 for free egress) > IPFS/Arweave for serving speed
- **CDN:** Cloudflare (free tier, zero egress from R2) or self-hosted Varnish/Nginx cache in front of MinIO
- **Payments:** x402 protocol (already in progress via `proj.x402-e2e-migration`) > custom smart contracts
- **Skip in v1:** IPFS pinning, fine-tuning, horizontal scaling, complex escrow

**Relationship to existing projects:**

- **proj.oss-research-node** — that project's P1 content pipeline (blog generation, static site) directly benefits from this infra. This project provides the generic content generation + CDN layer; oss-research-node is one consumer.
- **proj.x402-e2e-migration** — provides x402 inbound payment middleware. This project wires content generation behind those payment gates.
- **proj.graph-execution** — LangGraph patterns for the generation orchestration graphs.
- **proj.performance-efficiency** — CDN and caching strategies align.

## Roadmap

### Crawl (P0) — Image Generation Service + Object Storage

**Goal:** A working image generation API backed by Flux.1-schnell, storing outputs in S3-compatible storage, accessible via direct URL. No payment gate yet — prove the pipeline works.

| Deliverable                                                                                                              | Status      | Est | Work Item  |
| ------------------------------------------------------------------------------------------------------------------------ | ----------- | --- | ---------- |
| Spike: benchmark Flux.1-schnell on Akash GPU instances, confirm ComfyUI API contract, evaluate MinIO vs R2               | Not Started | 2   | story.0158 |
| ComfyUI + Flux.1-schnell Docker image: pre-baked weights, health endpoint, REST API                                      | Not Started | 2   | —          |
| Object storage adapter: S3-compatible port + MinIO adapter (Akash) + R2 adapter (cloud)                                  | Not Started | 2   | —          |
| Image generation contract: `src/contracts/content.image-generate.v1.contract.ts` (prompt, style, dimensions → image URL) | Not Started | 1   | —          |
| Image generation feature service: orchestrates ComfyUI call → upload to storage → return CDN URL                         | Not Started | 2   | —          |
| API route: `POST /api/v1/content/images/generate` with credit metering                                                   | Not Started | 1   | —          |
| CDN layer: Cloudflare in front of R2, or Nginx reverse proxy + cache in front of MinIO                                   | Not Started | 1   | —          |
| Integration tests: generate image → verify stored → verify served via CDN URL                                            | Not Started | 1   | —          |

### Walk (P1) — Blog Post Generation + Content Management

**Goal:** AI-generated blog posts with embedded AI images, served as static pages with SEO. x402 payment gate on generation APIs.

| Deliverable                                                                                                   | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| vLLM + open-weight LLM Docker image: Qwen 2.5 7B/72B, OpenAI-compatible API, health endpoint                  | Not Started | 2   | (create at P1 start) |
| Blog generation contract: `content.blog-generate.v1.contract.ts` (topic, style, length → markdown + metadata) | Not Started | 1   | (create at P1 start) |
| Blog generation graph: LangGraph pipeline (outline → sections → hero image → assemble → publish)              | Not Started | 3   | (create at P1 start) |
| Content storage schema: Postgres tables for posts (title, slug, markdown, status, metadata, image_urls)       | Not Started | 1   | (create at P1 start) |
| Static rendering: Next.js ISR or static export for published blog posts, with `<img>` pointing at CDN         | Not Started | 2   | (create at P1 start) |
| x402 payment gate on image + blog generation endpoints                                                        | Not Started | 1   | (create at P1 start) |
| SEO: Open Graph tags, structured data (Article schema), sitemap generation                                    | Not Started | 1   | (create at P1 start) |
| Image optimization: WebP/AVIF conversion on upload, responsive srcset generation                              | Not Started | 1   | (create at P1 start) |

### Run (P2+) — Content Autonomy + Decentralized Storage

**Goal:** Nodes autonomously generate and publish content on schedule, with optional IPFS archival and cross-node content syndication.

| Deliverable                                                                                           | Status      | Est | Work Item            |
| ----------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Scheduled content agent: autonomous research → generate → publish pipeline (cron or event-driven)     | Not Started | 3   | (create at P2 start) |
| IPFS pinning adapter: pin content hashes to IPFS after CDN publish (proof of existence, not serving)  | Not Started | 2   | (create at P2 start) |
| Content analytics: view counts, engagement metrics, revenue per post                                  | Not Started | 2   | (create at P2 start) |
| Multi-model image support: LoRA loading, style presets, img2img, inpainting                           | Not Started | 2   | (create at P2 start) |
| Cross-node content syndication: nodes republish each other's content with attribution + revenue share | Not Started | 3   | (create at P2 start) |
| Fine-tuning pipeline: LoRA training on node-specific style/brand from generated content               | Not Started | 3   | (create at P2 start) |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Next.js App                       │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ /api/v1/  │  │ /api/v1/     │  │ /blog/[slug] │ │
│  │ content/  │  │ content/     │  │ (ISR pages)  │ │
│  │ images/   │  │ blog/        │  │              │ │
│  │ generate  │  │ generate     │  │              │ │
│  └─────┬─────┘  └──────┬───────┘  └──────┬───────┘ │
│        │               │                 │          │
│  ┌─────▼───────────────▼─────────────────▼───────┐  │
│  │          Feature Services Layer                │  │
│  │  content-image.service  content-blog.service   │  │
│  └─────┬───────────────┬─────────────────┬───────┘  │
│        │               │                 │          │
│  ┌─────▼────┐  ┌───────▼──────┐  ┌──────▼───────┐  │
│  │ Ports:   │  │ Ports:       │  │ Ports:       │  │
│  │ ImageGen │  │ TextGen      │  │ ObjectStore  │  │
│  │ Port     │  │ Port (=LLM)  │  │ Port         │  │
│  └─────┬────┘  └───────┬──────┘  └──────┬───────┘  │
└────────┼───────────────┼────────────────┼───────────┘
         │               │                │
   ┌─────▼────┐  ┌───────▼──────┐  ┌──────▼───────┐
   │ ComfyUI  │  │ vLLM         │  │ MinIO / R2   │
   │ Flux.1   │  │ (OpenAI API) │  │ (S3 compat)  │
   │ (GPU)    │  │ (GPU)        │  │ + CDN edge   │
   └──────────┘  └──────────────┘  └──────────────┘
         │               │                │
         └───────────────┼────────────────┘
                         │
                   Akash / Docker
```

## Constraints

- All inference runs on OSS models — no proprietary API dependencies for content generation
- Image generation service is a sidecar container (ComfyUI), not embedded in the Node process
- Text generation reuses the existing LLM port (LiteLLM adapter) for P0; vLLM adapter added in P1 only if needed
- Object storage adapter follows hexagonal pattern: `ObjectStorePort` interface, S3 adapter implementation
- CDN URLs must be stable (content-addressed or slug-based) — no expiring signed URLs for published content
- Generated content must include provenance metadata (model, prompt hash, generation params) for transparency
- Blog content must be factually grounded — generation graph includes a verification step
- No new databases — content metadata lives in existing Postgres (new tables, same DB)
- Payment integration reuses x402 middleware — no custom payment contracts

## Dependencies

- [ ] `proj.x402-e2e-migration` P0 — x402 inbound middleware (needed for P1 payment gate)
- [ ] `proj.graph-execution` — LangGraph patterns for blog generation graph (needed for P1)
- [ ] Akash GPU availability — need 1x 16GB+ VRAM instance for Flux.1-schnell
- [ ] S3-compatible storage decision: MinIO on Akash vs Cloudflare R2 (spike will determine)

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### Why Flux.1-schnell over SDXL/SD3?

Flux.1-schnell generates in 4-8 diffusion steps (vs 20-50 for SDXL). On a single A4000 (16GB), that's ~2 seconds per 1024x1024 image. Quality exceeds SDXL. The "schnell" variant is Apache-2.0 licensed. This is the Pareto choice: best quality-per-GPU-second in the OSS ecosystem.

### Why vLLM over Ollama?

vLLM provides an OpenAI-compatible API out of the box, supports continuous batching (critical for concurrent requests), and PagedAttention for efficient memory use. Ollama is easier to set up but lacks production features (no batching, limited concurrency). Since we already use LiteLLM as a proxy, vLLM slots in as a backend with zero app code changes.

### Why MinIO/R2 over IPFS for serving?

IPFS retrieval is slow without a dedicated gateway, and gateways are centralized anyway. MinIO is S3-compatible (works with every SDK), self-hostable on Akash, and combined with Nginx caching gives us a CDN. R2 gives free egress globally. IPFS can be added as an archival layer in P2 for proof-of-existence without affecting serving latency.

### Storage cost model

- **MinIO on Akash:** ~$5-10/month for 100GB persistent storage + compute
- **Cloudflare R2:** $0.015/GB/month storage, $0 egress. 10GB free tier. 100GB = $1.50/month
- **Generated content volume estimate:** 1000 images/day × 500KB avg = 500MB/day = 15GB/month
- **Blog posts:** negligible storage (markdown + metadata)

R2 is cheaper and faster for serving. MinIO for full sovereignty. Support both via the S3 port abstraction.

### Pricing model (x402)

- Image generation: $0.01-0.05 USDC per image (covers GPU amortization + margin)
- Blog post generation: $0.10-0.50 USDC per post (multiple LLM calls + image generation)
- Content retrieval: free (served from CDN, monetized through SEO → conversion funnel)

### Relationship to proj.oss-research-node content pipeline

The oss-research-node project (P1) needs blog generation and static publishing. Rather than building content infra twice, this project provides the generic layer:

- **This project:** ImageGenPort, ObjectStorePort, CDN config, blog storage schema, static rendering
- **oss-research-node:** domain-specific content (OSS comparisons, license analysis), uses this project's infra

The oss-research-node's "content generation agent" and "blog publishing" deliverables should depend on this project's P0/P1 completion.
