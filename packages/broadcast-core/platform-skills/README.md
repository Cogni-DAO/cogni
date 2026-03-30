# Platform Skills

Per-platform content optimization guides for the broadcasting pipeline. Each file is a complete skill guide that an AI agent reads to understand how to adapt content for that platform.

## Adding a New Platform

1. Create `<platform-id>.md` in this directory following the existing structure
2. Add the platform ID to `PLATFORM_IDS` in `src/types.ts`
3. Register a `PublishPort` adapter in `apps/web/src/bootstrap/container.ts`

**That's it.** The broadcast-writer graph automatically discovers and reads the skill doc for the target platform. No code changes needed for the optimization step.

## Skill Doc Structure

Each platform guide must cover:
- **Platform Identity** — audience, content lifespan, how content spreads
- **Format Constraints** — character limits, media support, special features
- **What We Optimize For** — ranked goals with tactics
- **Tone & Voice** — what works, what fails (with rationale)
- **Content Patterns** — templates for common post types
- **Adaptation Rules** — numbered rules for the AI to follow
- **Examples** — strong vs weak examples with analysis

## Platforms

| Platform | File | Max Length | Key Feature |
|----------|------|-----------|-------------|
| X/Twitter | [x.md](x.md) | 280 chars | Threads, virality, engagement velocity |
| Discord | [discord.md](discord.md) | 2000 chars | Rich embeds, community channels, role pings |
| LinkedIn | [linkedin.md](linkedin.md) | 3000 chars | Professional tone, no links in body, comments |
| Bluesky | [bluesky.md](bluesky.md) | 300 chars | AT Protocol, facets, authenticity-first culture |
| Blog | [blog.md](blog.md) | No limit | SEO, markdown, long-form depth, reference value |
