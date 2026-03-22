import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runDebate, runExternalRound } from "../debate.js";
import { getDefaultModels } from "../models.js";
import { createSession } from "../sessions.js";
import { formatResult, formatRoundResponses } from "../format.js";

export function registerBrainstormTool(server: McpServer): void {
  server.tool(
    "brainstorm",
    "Run a multi-round brainstorming debate between multiple AI models. " +
      "IMPORTANT: Before calling this tool, you MUST ask the user to choose a mode:\n\n" +
      "1. **API mode** — Uses external API keys to call models (OpenAI, Gemini, DeepSeek, etc.). " +
      "Best when the user has API keys configured.\n" +
      "2. **Hosted mode** — No API keys needed. You execute prompts using sub-agents with models " +
      "available in your environment (opus/sonnet/haiku, GPT, Gemini, etc.). " +
      "Same model can be used multiple times — each run produces different perspectives.\n\n" +
      "Present these two options to the user with a one-liner explanation, then proceed based on their choice.\n\n" +
      "For API mode: set mode='api'. When participate=true (default), YOU also participate as a debater " +
      "alongside external models via brainstorm_respond.\n" +
      "For Hosted mode: set mode='hosted'. Ask the user which models to use, then spawn sub-agents " +
      "for each model, collect responses, and call brainstorm_collect.",
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
      participate: z
        .boolean()
        .default(true)
        .describe(
          "Whether Claude should actively participate as a debater in each round (default: true). " +
            "Set to false for a non-interactive debate between external models only."
        ),
      mode: z
        .enum(["api", "hosted"])
        .default("api")
        .describe(
          "Execution mode. 'api' (default): MCP server calls model APIs directly. " +
            "'hosted': MCP server returns prompts for the HOST to execute using its own model access " +
            "(e.g., Claude Code sub-agents, Copilot model switching). No API keys needed in hosted mode."
        ),
    },
    async ({ topic, models, rounds, synthesizer, systemPrompt, participate, mode }) => {
      try {
        const modelList =
          models && models.length > 0 ? models : getDefaultModels();

        // Auto-detect hosted mode: if user-provided models don't use "provider:model" format,
        // they're likely host model labels (e.g., "opus", "sonnet", "haiku", "gpt-4o")
        const effectiveMode =
          mode === "hosted" ||
          (models &&
            models.length > 0 &&
            models.every((m) => !m.includes(":")))
            ? "hosted"
            : mode;

        // Hosted mode: return prompts for host to execute
        if (effectiveMode === "hosted") {
          if (modelList.length < 2) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    "Need at least 2 models for hosted brainstorming. " +
                    "Specify models like: models: [\"opus\", \"sonnet\", \"haiku\"]",
                },
              ],
              isError: true,
            };
          }

          const synthesizerLabel = synthesizer || modelList[0];

          const session = createSession({
            topic,
            modelIdentifiers: modelList,
            totalRounds: rounds,
            synthesizerIdentifier: synthesizerLabel,
            systemPrompt,
            mode: "hosted",
            hostedPhase: "round",
          });

          const round1System =
            systemPrompt ||
            "You are participating in a multi-model brainstorming debate. " +
              "Provide your best thinking on the given topic. " +
              "Be specific, creative, and substantive.";

          return {
            content: [
              {
                type: "text" as const,
                text:
                  `# Brainstorm: ${topic}\n\n` +
                  `**Session:** ${session.id}\n` +
                  `**Mode:** hosted\n` +
                  `**Models:** ${modelList.join(", ")}\n` +
                  `**Synthesizer:** ${synthesizerLabel}\n` +
                  `**Round 1 of ${rounds}**\n\n` +
                  `## Prompt to Execute\n\n` +
                  `**System message:**\n${round1System}\n\n` +
                  `**User message:**\n${topic}\n\n` +
                  `---\n\n` +
                  `Execute the above prompt separately with each model: **${modelList.join("**, **")}**\n` +
                  `(e.g., use sub-agents with the specified model parameter)\n\n` +
                  `Then call \`brainstorm_collect\` with:\n` +
                  `- session_id: "${session.id}"\n` +
                  `- responses: [${modelList.map((m) => `{ model: "${m}", content: "..." }`).join(", ")}]`,
              },
            ],
          };
        }

        // Non-interactive mode: full debate without Claude
        if (!participate) {
          if (modelList.length < 2) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    "Need at least 2 models to brainstorm without participation. " +
                    `Currently only ${modelList.length} provider(s) configured. ` +
                    "Add more providers or set participate=true so you can join.",
                },
              ],
              isError: true,
            };
          }

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
        }

        // Interactive mode: Claude participates
        if (modelList.length < 1) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "Need at least 1 external model configured for interactive brainstorming. " +
                  "Add providers in brainstorm.config.json or via environment variables.",
              },
            ],
            isError: true,
          };
        }

        const onProgress = (msg: string) => {
          console.error(`[brainstorm] ${msg}`);
        };

        // Run round 1 with external models
        const { responses, failedModels } = await runExternalRound(
          topic,
          modelList,
          1,
          rounds,
          [],
          systemPrompt,
          onProgress
        );

        // Create session
        const session = createSession({
          topic,
          modelIdentifiers: modelList,
          totalRounds: rounds,
          synthesizerIdentifier: synthesizer || modelList[0],
          systemPrompt,
        });

        // Store round 1 external responses
        session.rounds.push(responses);
        session.currentRound = 1;
        for (const r of responses) session.totalCharsProcessed += r.content.length;
        for (const f of failedModels) session.failedModels.add(f);

        const roundText = formatRoundResponses(responses);

        const isLastRound = rounds === 1;
        const turnInstruction = isLastRound
          ? `**Your turn.** This is the only round. After your response, the debate will be synthesized.\n\n`
          : `**Your turn.** Read the external models' responses above and form your own position. ` +
            `You have ${rounds - 1} more round(s) after this to refine.\n\n`;

        return {
          content: [
            {
              type: "text" as const,
              text:
                `# Brainstorm: ${topic}\n\n` +
                `**Session:** ${session.id}\n` +
                `**Models:** ${modelList.join(", ")} + you (Claude)\n` +
                `**Round 1 of ${rounds}**\n\n` +
                `## External Model Responses\n\n${roundText}\n` +
                `---\n\n` +
                turnInstruction +
                `Call \`brainstorm_respond\` with:\n` +
                `- session_id: "${session.id}"\n` +
                `- response: your substantive contribution to the debate\n\n` +
                `Engage with the other models' specific points — agree, disagree, build upon, or challenge.`,
            },
          ],
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
