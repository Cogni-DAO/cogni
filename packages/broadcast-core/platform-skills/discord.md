# Discord — Platform Skill Guide

## Platform Identity

Discord is a community-first platform built around servers (groups) and channels (topics). Content lives in real-time chat streams — it's conversational, not broadcast. Posts are seen by opted-in community members, not the general public.

**Primary audience:** Developer communities, DAOs, gaming, crypto, OSS projects. People who already care about your project.
**Content lifespan:** Minutes in active channels, longer in announcement channels.
**How content spreads:** Channel subscriptions, @mentions, role pings. No algorithmic amplification — reach = server membership.

## Format Constraints

- **Max length:** 2000 characters per message (4000 for Nitro)
- **Rich embeds:** Webhook posts can include structured embeds (title, description, fields, color, thumbnail, footer). Use these for announcements.
- **Markdown:** Full support — bold, italic, code blocks, headers, lists, links, spoilers.
- **Media:** Images, videos, files inline. Screen recordings work well.
- **Mentions:** @everyone (server-wide), @here (online only), @role (specific group). Use @everyone sparingly — it's disruptive.
- **Reactions:** Emoji reactions are the primary engagement signal. Design for them.

## What We Optimize For

| Goal | Weight | How |
|------|--------|-----|
| Community awareness | High | Clear, scannable announcements that respect attention |
| Discussion/replies | High | Ask for feedback, link to discussion channels |
| Actionable clarity | High | If there's a CTA, make it unmissable |
| Role engagement | Medium | Ping the right role, not @everyone for everything |

## Tone & Voice

**What works:**
- Conversational but informative ("hey everyone — quick update on X")
- Structured embeds for formal announcements (release notes, governance votes)
- Bullet points and clear formatting — people scan, they don't read
- Acknowledging the community ("based on feedback from #suggestions...")
- Direct links to relevant channels for follow-up

**What fails:**
- Corporate announcements copy-pasted from press releases
- Walls of unformatted text
- Pinging @everyone for minor updates
- Cross-posting identical content across multiple channels
- No context (linking a URL with no summary)

## Content Patterns

### Announcement (embed)
```
Title: [Feature/Update Name]
Description: [2-3 sentence summary of what changed and why it matters]
Fields:
  - What's New: [bullet list]
  - Breaking Changes: [if any]
  - Try It: [link or command]
Footer: [version/date]
Color: [brand color]
```

### Update (conversational)
```
hey all — shipped [feature] today

what it does:
- [benefit 1]
- [benefit 2]

what's next:
- [upcoming work]

feedback welcome in #feedback
```

### Governance/Vote
```
**[Proposal Title]**

TL;DR: [one sentence]

[2-3 sentences of context]

Vote: [link]
Deadline: [date]

React with the checkmark if you've read this.
```

## Adaptation Rules

When adapting content for Discord:
1. **Use embeds for announcements, plain text for updates.** Match formality to importance.
2. **Front-load the TL;DR.** Community members scan quickly.
3. **Include clear CTAs.** "React with checkmark" or "discuss in #channel" or "try it: `pnpm dev`"
4. **Format for scanning.** Bullets, bold key terms, code blocks for commands.
5. **Respect notification etiquette.** @here for important live updates, @everyone only for critical announcements, role pings for targeted updates.
6. **Link to discussion channels** rather than expecting replies in announcement channels.

## Examples

### Strong
> **Billing System v2 is live**
>
> TL;DR: All transactions are now on-chain and verifiable by any DAO member.
>
> What changed:
> - Transparent transaction log (no more trust-us accounting)
> - Real-time balance dashboard at `/credits`
> - Auto-settlement every 24h
>
> Breaking: Old API keys need regeneration — see #migration-guide
>
> Questions? Drop them in #billing-support

### Weak
> We're excited to announce that our new billing system leverages cutting-edge blockchain technology to provide transparent and verifiable transactions for our DAO community! This is a major milestone in our journey towards full decentralization and we couldn't be more thrilled to share this with you all. Please visit our website for more details.
