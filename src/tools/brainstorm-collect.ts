import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession, deleteSession } from "../sessions.js";
import { buildHistoryContext, estimateTokens, estimateCost, getRoundNSystem, getSynthesisSystem, buildEffectiveTopic } from "../debate.js";
import { formatResult } from "../format.js";
import { RoundResponse, DebateResult } from "../types.js";

export function registerBrainstormCollectTool(server: McpServer): void {
  server.tool(
    "brainstorm_collect",
    "Submit collected model responses for a hosted brainstorm session. " +
      "After receiving prompts from `brainstorm` (mode='hosted') or a previous `brainstorm_collect` call, " +
      "execute each prompt by spawning a sub-agent for EACH model (use the model parameter to select " +
      "the right model, e.g., model='sonnet' or model='haiku'). Collect all responses and submit them here. " +
      "This tool returns either: (1) the next round's prompt to execute, (2) a synthesis prompt for a single model, " +
      "or (3) the final formatted debate result when complete.",
    {
      session_id: z
        .string()
        .describe("The session ID from the brainstorm tool"),
      responses: z
        .array(
          z.object({
            model: z.string().describe("The model label (e.g. 'opus', 'sonnet')"),
            content: z.string().describe("The model's response text"),
          })
        )
        .min(1)
        .describe("Array of model responses collected by the host"),
    },
    async ({ session_id, responses }) => {
      try {
        const session = getSession(session_id);
        if (!session) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "Session not found or expired. Sessions expire after 10 minutes. " +
                  "Start a new brainstorm session by calling the `brainstorm` tool.",
              },
            ],
            isError: true,
          };
        }

        if (session.mode !== "hosted") {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "This session is not in hosted mode. " +
                  "Use `brainstorm_respond` for interactive (API) sessions.",
              },
            ],
            isError: true,
          };
        }

        // Handle synthesis response
        if (session.hostedPhase === "synthesis") {
          const synthesisText = responses[0]?.content || "";
          session.totalCharsProcessed += synthesisText.length;

          const totalDurationMs = Date.now() - session.startTime;
          const estimatedTokensVal =
            estimateTokens(session.topic.repeat(session.totalRounds)) +
            Math.ceil(session.totalCharsProcessed / 4);

          const result: DebateResult = {
            topic: session.topic,
            rounds: session.rounds,
            synthesis: synthesisText,
            modelsFailed: Array.from(session.failedModels),
            stats: {
              totalDurationMs,
              estimatedTokens: estimatedTokensVal,
              estimatedCost: estimateCost(
                session.modelIdentifiers,
                estimatedTokensVal
              ),
            },
          };

          deleteSession(session_id);

          return {
            content: [
              { type: "text" as const, text: formatResult(result) },
            ],
          };
        }

        // Store round responses
        const roundNumber = session.currentRound + 1;
        const roundResponses: RoundResponse[] = responses.map((r) => ({
          modelId: r.model,
          round: roundNumber,
          content: r.content,
        }));

        session.rounds.push(roundResponses);
        session.currentRound = roundNumber;
        for (const r of roundResponses) {
          session.totalCharsProcessed += r.content.length;
        }

        // Check if we need more rounds or synthesis
        if (roundNumber < session.totalRounds) {
          // Generate next round prompt
          const nextRound = roundNumber + 1;
          const history = buildHistoryContext(session.rounds);

          const roundSystem = getRoundNSystem(nextRound, session.totalRounds, session.style);

          const effectiveTopic = buildEffectiveTopic(session.topic, session.context);
          const roundUserMessage =
            `Original topic: ${effectiveTopic}\n\n${history}\n\n` +
            `Now provide your refined response for round ${nextRound}. Consider all perspectives above.`;

          return {
            content: [
              {
                type: "text" as const,
                text:
                  `## Round ${nextRound} of ${session.totalRounds}\n\n` +
                  `## Prompt to Execute\n\n` +
                  `**System message:**\n${roundSystem}\n\n` +
                  `**User message:**\n${roundUserMessage}\n\n` +
                  `---\n\n` +
                  `Execute the above prompt separately with each model: **${session.modelIdentifiers.join("**, **")}**\n\n` +
                  `Then call \`brainstorm_collect\` with:\n` +
                  `- session_id: "${session_id}"\n` +
                  `- responses: [${session.modelIdentifiers.map((m) => `{ model: "${m}", content: "..." }`).join(", ")}]`,
              },
            ],
          };
        }

        // Last round done — generate synthesis prompt
        session.hostedPhase = "synthesis";

        const fullHistory = buildHistoryContext(session.rounds);

        const synthesisSystem = getSynthesisSystem(session.style);

        const effectiveTopicSynth = buildEffectiveTopic(session.topic, session.context);
        const synthesisUserMessage =
          `Original topic: ${effectiveTopicSynth}\n\n${fullHistory}\n\n` +
          `Please synthesize the above debate into a structured verdict.`;

        const synthModel = session.synthesizerIdentifier;

        return {
          content: [
            {
              type: "text" as const,
              text:
                `## Synthesis\n\n` +
                `All ${session.totalRounds} round(s) complete. Now synthesize the debate.\n\n` +
                `## Prompt to Execute\n\n` +
                `**Synthesizer model:** ${synthModel}\n\n` +
                `**System message:**\n${synthesisSystem}\n\n` +
                `**User message:**\n${synthesisUserMessage}\n\n` +
                `---\n\n` +
                `Execute the above prompt with **${synthModel}**.\n\n` +
                `Then call \`brainstorm_collect\` with:\n` +
                `- session_id: "${session_id}"\n` +
                `- responses: [{ model: "${synthModel}", content: "..." }]`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `brainstorm_collect failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
