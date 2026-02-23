import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runDebate } from "../debate.js";
import { getDefaultModels } from "../models.js";
import { DebateResult } from "../types.js";

function formatResult(result: DebateResult): string {
  const lines: string[] = [];

  lines.push(`# Brainstorm: ${result.topic}\n`);

  const allModelIds = [
    ...new Set(result.rounds[0]?.map((r) => r.modelId) ?? []),
  ];
  lines.push(`**Models:** ${allModelIds.join(", ")}`);
  lines.push(`**Rounds:** ${result.rounds.length}`);
  lines.push(
    `**Duration:** ${(result.stats.totalDurationMs / 1000).toFixed(1)}s | ` +
      `**Tokens:** ~${result.stats.estimatedTokens.toLocaleString()} | ` +
      `**Cost:** ${result.stats.estimatedCost}`
  );
  if (result.modelsFailed.length > 0) {
    lines.push(
      `**Failures:** ${result.modelsFailed.join(", ")} (had errors in some rounds)`
    );
  }
  lines.push("");

  for (let r = 0; r < result.rounds.length; r++) {
    const roundLabel =
      r === 0
        ? "Initial Perspectives"
        : r === result.rounds.length - 1
          ? "Final Positions"
          : "Refinement";
    lines.push(`## Round ${r + 1} — ${roundLabel}\n`);

    for (const resp of result.rounds[r]) {
      lines.push(`### ${resp.modelId}\n`);
      if (resp.error) {
        lines.push(`> **ERROR:** ${resp.error}\n`);
      } else {
        lines.push(`${resp.content}\n`);
      }
    }
  }

  lines.push(`---\n`);
  lines.push(`## Synthesis\n`);
  lines.push(result.synthesis);
  lines.push("");

  const failNote =
    result.modelsFailed.length > 0
      ? ` ${result.modelsFailed.length} model(s) had failures.`
      : "";
  lines.push(
    `---\n*Debate completed in ${(result.stats.totalDurationMs / 1000).toFixed(1)}s. ` +
      `${allModelIds.length} models, ${result.rounds.length} round(s). ` +
      `~${result.stats.estimatedTokens.toLocaleString()} tokens (${result.stats.estimatedCost}).${failNote}*`
  );

  return lines.join("\n");
}

export function registerBrainstormTool(server: McpServer): void {
  server.tool(
    "brainstorm",
    "Run a multi-round brainstorming debate between multiple AI models. " +
      "Just provide a topic and all configured models will automatically participate. " +
      "Models debate, critique, and refine ideas across rounds, " +
      "then a synthesizer produces a final consolidated output.",
    {
      topic: z
        .string()
        .describe("The topic, question, or prompt to brainstorm about"),
      models: z
        .array(z.string())
        .optional()
        .describe(
          "Optional: specific models to use as 'provider:model' (e.g. 'openai:gpt-4o'). " +
            "If not provided, all configured providers are used with their default models."
        ),
      rounds: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(3)
        .describe("Number of debate rounds (default: 3)"),
      synthesizer: z
        .string()
        .optional()
        .describe(
          "Optional: model for final synthesis as 'provider:model'. Defaults to the first model."
        ),
      systemPrompt: z
        .string()
        .optional()
        .describe(
          "Optional system prompt to guide the brainstorming style or constraints"
        ),
    },
    async ({ topic, models, rounds, synthesizer, systemPrompt }) => {
      try {
        const modelList =
          models && models.length > 0 ? models : getDefaultModels();

        if (modelList.length < 2) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "Need at least 2 models to brainstorm. " +
                  `Currently only ${modelList.length} provider(s) have API keys configured. ` +
                  "Add more providers with their API keys in .mcp.json.",
              },
            ],
            isError: true,
          };
        }

        // Progress callback logs to stderr (visible in MCP server logs)
        const onProgress = (msg: string) => {
          console.error(`[brainstorm] ${msg}`);
        };

        const result = await runDebate(
          topic,
          modelList,
          rounds,
          synthesizer,
          systemPrompt,
          onProgress
        );
        return {
          content: [{ type: "text" as const, text: formatResult(result) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Brainstorm failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
