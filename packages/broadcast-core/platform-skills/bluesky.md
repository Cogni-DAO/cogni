# Bluesky — Platform Skill Guide

## Platform Identity

Bluesky is a decentralized microblogging platform (AT Protocol) that positions itself as the "open" alternative to X. The culture is anti-corporate, pro-open-source, and values authenticity over polish. Custom feeds (powered by algorithms users choose) mean content discovery is opt-in and transparent.

**Primary audience:** Tech early adopters, OSS developers, journalists, academics, ex-Twitter users who value open protocols.
**Content lifespan:** Hours to days. Custom feeds can resurface content longer than chronological.
**How content spreads:** Reposts, likes, custom feed algorithms (user-selected), follows. No opaque algorithmic manipulation.

## Format Constraints

- **Max length:** 300 characters (graphemes, not bytes)
- **Facets:** Rich text annotations for links, mentions, hashtags — rendered inline (not URL cards like X)
- **Media:** Up to 4 images with alt text, no video (yet)
- **Links:** Inline via facets. No t.co-style wrapping — real URLs visible.
- **Mentions:** @handle.bsky.social — rendered as clickable links
- **Threading:** Reply chains, same as X. Self-reply for threads.
- **Custom feeds:** Users subscribe to algorithmic feeds. Getting indexed by popular feeds extends reach significantly.
- **Starter packs:** Curated follow lists — getting added to one is high-value.

## What We Optimize For

| Goal | Weight | How |
|------|--------|-----|
| Reposts | High | Shareable insights, open-source wins, protocol-level takes |
| Custom feed indexing | High | Use relevant terms that feed algorithms match on |
| Community building | High | Engage genuinely, respond to replies, boost others |
| Likes | Medium | Signal for feed algorithms |

## Tone & Voice

**What works:**
- Genuine, unpolished, building-in-public energy
- Technical depth appreciated (this audience is technical)
- Open source announcements and contributions
- Protocol/decentralization commentary
- Humor and personality — the culture is more relaxed than LinkedIn, more earnest than X

**What fails:**
- Polished corporate marketing
- Growth hacking tactics (follow-for-follow, engagement pods)
- Treating it as "backup Twitter" — the culture is distinct
- AI-generated slop (this community is highly AI-aware and allergic to it)
- Threads longer than 4-5 posts (the 300-char limit makes threads tedious)

## Content Patterns

### Announcement
```
[What shipped] — [one-line why it matters]

[1-2 details]

[Link to repo/docs/demo]
```

### Technical Take
```
[Observation about tech/protocol/industry]

[Specific supporting evidence or experience]
```

### Open Source
```
Just shipped [feature] to [project]

[What it does in one sentence]

[Link to PR or release]

Feedback welcome
```

## Adaptation Rules

When adapting content for Bluesky:
1. **300 chars is tight.** Be ruthlessly concise. One idea per post.
2. **Don't thread heavily.** If content needs > 3-4 posts, it's probably better as a blog post (link to it).
3. **Links are first-class.** Unlike X/LinkedIn, links don't hurt reach. Include them freely.
4. **Alt text on images.** The community values accessibility and will call out missing alt text.
5. **Use facets for mentions and links** — they render as rich text, not raw URLs.
6. **Authenticity over polish.** This audience can smell AI-generated content. Preserve the human voice.
7. **No hashtag spam.** Hashtags are less important here than on X/LinkedIn. Use 0-1.

## Examples

### Strong
> Shipped on-chain billing for our DAO today. 47 members can now independently verify every transaction without trusting a central DB.
>
> All open source: github.com/cogni-dao/node

### Weak
> We're thrilled to announce our revolutionary blockchain billing solution! This innovative approach brings unprecedented transparency to DAO financial operations. Learn more at our website! #blockchain #DAO #web3 #innovation #crypto
