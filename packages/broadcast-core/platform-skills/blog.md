# Blog — Platform Skill Guide

## Platform Identity

The blog is long-form, owned content — published on the project's own domain. It's the canonical source of truth for announcements, technical deep-dives, and thought leadership. Blog posts are permanent, SEO-indexed, and referenced by all other platforms.

**Primary audience:** Developers evaluating the project, potential contributors, investors doing due diligence, journalists looking for quotable material.
**Content lifespan:** Months to years. Evergreen content compounds via search.
**How content spreads:** Search engines (SEO), social media links, newsletters, aggregators (HN, Reddit, dev.to).

## Format Constraints

- **Max length:** No hard limit. Aim for 800-2000 words. Longer is fine for technical content if every paragraph earns its keep.
- **Format:** Markdown with frontmatter (title, date, author, tags, description, slug)
- **Media:** Images with alt text, code blocks with syntax highlighting, diagrams (Mermaid), embedded videos
- **SEO:** Meta description (155 chars), title tag (60 chars), structured data, canonical URL
- **Links:** Internal cross-references to docs/specs, external references with context

## What We Optimize For

| Goal | Weight | How |
|------|--------|-----|
| Search traffic (SEO) | Highest | Target specific queries, use structured headings, write meta descriptions |
| Authority/credibility | High | Specifics, data, code examples, honest tradeoff analysis |
| Shareability | High | Strong title + intro that works when linked from X/LinkedIn/HN |
| Reference value | High | Content people bookmark and return to |

## Tone & Voice

**What works:**
- Technical depth with clear structure (headings, code blocks, diagrams)
- "Here's what we built, here's why, here's what we learned" narrative
- Honest tradeoff analysis (not just selling — acknowledging limitations)
- Actionable content (tutorials, how-tos, architecture decisions)
- Data and specifics over generalities

**What fails:**
- Thin content (< 400 words) that could be a tweet
- All-hype-no-substance announcements
- Burying the lede — put the conclusion first, then explain
- SEO keyword stuffing
- Content that's just a changelog dressed up as a blog post

## Content Patterns

### Technical Deep-Dive
```markdown
# [Title: What + Why]

[2-3 sentence intro: what this is about and why the reader should care]

## The Problem

[What was broken / what prompted this work]

## What We Built

[Architecture, design decisions, code examples]

## Results

[Metrics, before/after, tradeoffs]

## What We'd Do Differently

[Honest retrospective]

## Try It / Learn More

[Links to code, docs, demo]
```

### Announcement
```markdown
# [Product/Feature Name]: [Value Proposition]

[TL;DR paragraph — the whole story in 3 sentences]

## What's New

[Bullet list of changes with links]

## Why This Matters

[Context for why users should care]

## Getting Started

[Quick start guide or migration notes]

## What's Next

[Roadmap teaser]
```

## Adaptation Rules

When adapting content for blog:
1. **Expand, don't pad.** Blog posts should add depth the other platforms can't. Add code examples, architecture diagrams, data.
2. **Structure for scanning.** H2/H3 headings, bullet lists, code blocks. Readers scan before committing to read.
3. **Write the meta description.** 155 chars that make someone click from Google. This IS the SEO.
4. **Strong first paragraph.** It appears in social media link previews and search results.
5. **Include code examples** for technical content. Real code > pseudocode > prose descriptions.
6. **Link generously.** Internal links to docs/specs, external links to references. Blogs are web-native.
7. **Frontmatter is required:** title, date, author, tags, description, slug.

## Examples

### Strong Title + Intro
> # On-Chain Billing for DAOs: What We Learned After 6 Months
>
> We moved our entire billing system to an L2 blockchain so 47 DAO members could independently verify every transaction. Six months in, dispute resolution dropped 90% — but gas costs and governance overhead surprised us. Here's the full breakdown.

### Weak Title + Intro
> # Exciting New Billing System Update
>
> We're pleased to announce that we've updated our billing system with new blockchain technology. This blog post will walk you through the changes we've made and why we think they're important.
