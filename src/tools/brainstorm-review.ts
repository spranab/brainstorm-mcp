import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runExternalRound, runSynthesis, estimateTokens, estimateCost } from "../debate.js";
import { getDefaultModels } from "../models.js";
import { RoundResponse, DebateResult } from "../types.js";

const REVIEW_SYSTEM_PROMPT =
  "You are reviewing a code change. Focus on issues likely introduced by this diff. " +
  "For each finding, specify:\n" +
  "- **Severity**: critical / high / medium / low\n" +
  "- **Category**: correctness / security / performance / maintainability / tests\n" +
  "- **File & lines** (if identifiable from the diff)\n" +
  "- **Title**: one-line summary\n" +
  "- **Explanation**: why this matters\n" +
  "- **Suggestion**: how to fix it\n\n" +
  "Prefer fewer high-confidence findings over many low-signal ones. " +
  "Do NOT nitpick style unless it affects correctness or maintainability. " +
  "Do NOT review code that wasn't changed. " +
  "If there are no significant issues, say so clearly.";

const REVIEW_SYNTHESIS_PROMPT =
  "You are synthesizing a multi-model code review. Produce a structured verdict:\n\n" +
  "## Verdict\n" +
  "One of: **approve** / **approve with warnings** / **needs changes**\n" +
  "One sentence explaining why.\n\n" +
  "## Findings\n" +
  "A markdown table with columns: Severity | Category | File | Lines | Finding | Suggestion\n" +
  "Merge duplicate findings from different models. Order by severity (critical first).\n" +
  "Include at most 10 findings. Drop low-signal items.\n\n" +
  "## Model Agreement\n" +
  "Which issues were flagged by multiple models (high confidence) vs. only one (worth investigating).\n\n" +
  "Be concise. This output should be suitable for posting as a PR comment.";

export function registerBrainstormReviewTool(server: McpServer): void {
  server.tool(
    "brainstorm_review",
    "Multi-model code review. Pass a diff and get structured findings with severity, " +
      "file/line references, and a verdict (approve / approve with warnings / needs changes). " +
      "Multiple models review independently, then findings are synthesized and deduplicated. " +
      "Use this for PR reviews, code audits, or pre-commit checks.",
    {
      diff: z
        .string()
        .describe("The unified diff to review (e.g., output of `git diff`)"),
      title: z
        .string()
        .optional()
        .describe("Optional: PR title or change summary for context"),
      description: z
        .string()
        .optional()
        .describe("Optional: PR description or commit message"),
      instructions: z
        .string()
        .optional()
        .describe(
          "Optional: repo-specific review instructions (e.g., 'we use strict null checks', " +
            "'focus on SQL injection risks')"
        ),
      focus: z
        .union([
          z.array(
            z.enum([
              "correctness",
              "security",
              "performance",
              "maintainability",
              "tests",
            ])
          ),
          z.enum([
            "correctness",
            "security",
            "performance",
            "maintainability",
            "tests",
          ]),
        ])
        .optional()
        .transform((val) =>
          val ? (Array.isArray(val) ? val : [val]) : undefined
        )
        .describe(
          "Optional: focus areas for the review. Default: all categories."
        ),
      models: z
        .array(z.string())
        .optional()
        .describe(
          "Optional: specific models as 'provider:model'. Default: all configured providers."
        ),
    },
    { readOnlyHint: true },
    async ({ diff, title, description, instructions, focus, models }) => {
      try {
        const startTime = Date.now();
        const modelList =
          models && models.length > 0 ? models : getDefaultModels();

        if (modelList.length < 1) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Need at least 1 model configured for review.",
              },
            ],
            isError: true,
          };
        }

        const onProgress = (msg: string) => {
          console.error(`[brainstorm_review] ${msg}`);
        };

        // Build the review prompt
        const userParts: string[] = [];
        if (title) userParts.push(`**PR Title:** ${title}`);
        if (description) userParts.push(`**Description:** ${description}`);
        if (focus && focus.length > 0) {
          userParts.push(`**Focus areas:** ${focus.join(", ")}`);
        }
        if (instructions) {
          userParts.push(`**Review instructions:** ${instructions}`);
        }
        userParts.push(`\n## Diff to Review\n\n\`\`\`diff\n${diff}\n\`\`\``);

        const userMessage = userParts.join("\n");

        // Run all models in parallel — single round, redteam-style review
        onProgress(`Starting review with ${modelList.length} model(s)...`);

        const { responses, failedModels } = await runExternalRound(
          userMessage,
          modelList,
          1,
          1,
          [],
          REVIEW_SYSTEM_PROMPT,
          onProgress
        );

        // Run synthesis with review-specific prompt
        onProgress("Synthesizing findings...");

        const synthesisRounds: RoundResponse[][] = [responses];
        const synthesis = await runSynthesis(
          userMessage,
          synthesisRounds,
          modelList[0],
          modelList,
          onProgress,
          undefined, // no style override — we use our own synthesis prompt
          REVIEW_SYNTHESIS_PROMPT
        );

        const durationMs = Date.now() - startTime;
        const totalChars =
          responses.reduce((n, r) => n + r.content.length, 0) +
          synthesis.length;
        const tokens =
          estimateTokens(userMessage.repeat(modelList.length)) +
          Math.ceil(totalChars / 4);
        const cost = estimateCost(modelList, tokens);

        // Format output
        const lines: string[] = [];
        lines.push(`# Code Review: ${title || "Untitled Change"}\n`);
        lines.push(
          `**Reviewers:** ${modelList.join(", ")} | ` +
            `**Time:** ${(durationMs / 1000).toFixed(1)}s | ` +
            `**Cost:** ${cost}`
        );
        if (failedModels.length > 0) {
          lines.push(
            `**Failures:** ${failedModels.join(", ")}`
          );
        }
        lines.push("");
        lines.push(synthesis);
        lines.push("");

        // Include individual model reviews as collapsible details
        lines.push(`\n---\n`);
        lines.push(`## Individual Model Reviews\n`);
        for (const resp of responses) {
          if (resp.error) {
            lines.push(`### ${resp.modelId} — FAILED\n`);
            lines.push(`> ${resp.error}\n`);
          } else {
            lines.push(`### ${resp.modelId}\n`);
            lines.push(`${resp.content}\n`);
          }
        }

        lines.push(
          `\n---\n*Review completed in ${(durationMs / 1000).toFixed(1)}s. ` +
            `${modelList.length} model(s), ${cost}.*`
        );

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `brainstorm_review failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
