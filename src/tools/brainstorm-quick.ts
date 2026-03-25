import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runExternalRound, getRound1System, buildEffectiveTopic, estimateTokens, estimateCost } from "../debate.js";
import { getDefaultModels } from "../models.js";

export function registerBrainstormQuickTool(server: McpServer): void {
  server.tool(
    "brainstorm_quick",
    "Get instant multi-model perspectives on any question — no debate rounds, no synthesis delay. " +
      "Fires all models in parallel and returns a compact comparison. Under 10 seconds. " +
      "Use this for quick second opinions, snap decisions, or when you want diverse perspectives fast. " +
      "For deeper analysis with multiple rounds and synthesis, use the `brainstorm` tool instead.",
    {
      topic: z
        .string()
        .describe("The question or topic to get quick perspectives on"),
      models: z
        .array(z.string())
        .optional()
        .describe(
          "Optional: specific models as 'provider:model'. If not provided, all configured providers are used."
        ),
      context: z
        .string()
        .optional()
        .describe(
          "Optional context — code snippets, error logs, etc. Models will see this alongside the topic."
        ),
      style: z
        .enum(["freeform", "redteam", "socratic"])
        .default("freeform")
        .describe("Perspective style (default: freeform)"),
    },
    { readOnlyHint: true },
    async ({ topic, models, context, style }) => {
      try {
        const startTime = Date.now();
        const modelList =
          models && models.length > 0 ? models : getDefaultModels();

        if (modelList.length < 1) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Need at least 1 model configured. Add providers in brainstorm.config.json or via environment variables.",
              },
            ],
            isError: true,
          };
        }

        const onProgress = (msg: string) => {
          console.error(`[brainstorm_quick] ${msg}`);
        };

        const effectiveTopic = buildEffectiveTopic(topic, context);
        const systemPrompt = getRound1System(style);

        // Fire all models in parallel — single round, no cross-model interaction
        const { responses } = await runExternalRound(
          effectiveTopic,
          modelList,
          1,
          1,
          [],
          systemPrompt,
          onProgress
        );

        const durationMs = Date.now() - startTime;
        const totalChars = responses.reduce((n, r) => n + r.content.length, 0);
        const tokens = estimateTokens(effectiveTopic.repeat(modelList.length)) + Math.ceil(totalChars / 4);
        const cost = estimateCost(modelList, tokens);

        // Format as compact comparison
        const lines: string[] = [];
        lines.push(`# Quick Brainstorm: ${topic}\n`);
        lines.push(
          `**Models:** ${modelList.join(", ")} | ` +
            `**Time:** ${(durationMs / 1000).toFixed(1)}s | ` +
            `**Cost:** ${cost}\n`
        );

        const failed = responses.filter((r) => r.error);
        if (failed.length > 0) {
          lines.push(
            `**Failures:** ${failed.map((f) => f.modelId).join(", ")}\n`
          );
        }

        for (const resp of responses) {
          lines.push(`## ${resp.modelId}\n`);
          if (resp.error) {
            lines.push(`> **ERROR:** ${resp.error}\n`);
          } else {
            lines.push(`${resp.content}\n`);
          }
        }

        lines.push(
          `---\n*${responses.length - failed.length} model(s) responded in ${(durationMs / 1000).toFixed(1)}s.*`
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
              text: `brainstorm_quick failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
