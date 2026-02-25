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
      "By default, YOU (Claude) participate as an active debater alongside the external models. " +
      "When participate=true (default), this tool returns after external models respond in round 1. " +
      "You MUST then read their responses, form your own perspective, and call brainstorm_respond " +
      "with your contribution. This repeats each round until the debate concludes with a synthesis. " +
      "When participate=false, the full debate runs without your input.",
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
    },
    async ({ topic, models, rounds, synthesizer, systemPrompt, participate }) => {
      try {
        const modelList =
          models && models.length > 0 ? models : getDefaultModels();

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
