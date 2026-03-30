// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/broadcast-writer/prompts`
 * Purpose: System prompt and user message builder for the broadcast-writer graph.
 * Scope: Prompt templates only. Does not contain graph logic or LLM calls.
 * Invariants:
 *   - System prompt is platform-agnostic — platform knowledge comes via user message
 *   - User message includes the full platform skill guide
 * Side-effects: none
 * Links: packages/broadcast-core/platform-skills/
 * @public
 */

/**
 * System prompt for the broadcast-writer graph.
 *
 * The graph receives platform-specific guidance in the user message (the skill guide).
 * The system prompt defines the role and output format. This separation means:
 * - Adding a platform = adding a markdown file, not changing prompts
 * - Updating platform strategy = editing markdown, not redeploying code
 */
export const BROADCAST_WRITER_SYSTEM_PROMPT = `You are a content adaptation specialist. Your job is to take platform-agnostic content and adapt it for a specific platform, following the platform's skill guide exactly.

## Your Task

You will receive:
1. A **Platform Skill Guide** — the rules, tone, constraints, and examples for the target platform
2. The **Original Content** — platform-agnostic text that needs adaptation
3. Optionally, a **Title** and **Optimization Goals**

## Output Requirements

Produce the adapted content directly. Your entire response IS the post content — do not wrap it in explanations, headers, or metadata.

For threaded platforms (X, Bluesky): separate each post in the thread with a line containing only "---".

For blog posts: output full markdown with frontmatter.

For Discord embeds: output the message body text (embed structure is handled by the publish adapter).

## Rules

1. Follow every rule in the Platform Skill Guide. They are specific and intentional.
2. Respect format constraints (character limits, media rules, link placement).
3. Preserve the core message and voice of the original content. Adapt format, not meaning.
4. If the original content cannot fit the platform's constraints (e.g., a 2000-word essay into 280 chars), create the best possible summary/hook that links to the full content.
5. Do NOT add information that isn't in the original content. You may rephrase, restructure, and condense — but do not fabricate claims or statistics.
6. Do NOT use generic AI filler ("In today's rapidly evolving landscape...", "Let's dive in!", etc.)
7. When the skill guide shows examples of what fails, avoid those patterns completely.` as const;

/**
 * Build the user message for a broadcast-writer graph run.
 *
 * Combines the platform skill guide with the original content into a single
 * user message. The graph receives everything it needs in one shot.
 */
export function buildBroadcastWriterMessage(params: {
	readonly platformSkillGuide: string;
	readonly platformId: string;
	readonly body: string;
	readonly title?: string;
	readonly goals?: string;
}): string {
	const { platformSkillGuide, platformId, body, title, goals } = params;

	const sections = [
		`## Platform Skill Guide (${platformId})\n\n${platformSkillGuide}`,
		`## Original Content\n\n${title ? `**Title:** ${title}\n\n` : ""}${body}`,
	];

	if (goals) {
		sections.push(`## Optimization Goals\n\n${goals}`);
	}

	sections.push(
		"## Instructions\n\nAdapt the original content for this platform following the skill guide above. Output ONLY the adapted post content.",
	);

	return sections.join("\n\n---\n\n");
}
