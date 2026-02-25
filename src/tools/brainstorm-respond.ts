import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession, deleteSession } from "../sessions.js";
import { runExternalRound, runSynthesis, estimateTokens, estimateCost } from "../debate.js";
import { formatResult, formatRoundResponses } from "../format.js";
import { RoundResponse, DebateResult } from "../types.js";

export function registerBrainstormRespondTool(server: McpServer): void {
  server.tool(
    "brainstorm_respond",
    "Submit YOUR (Claude's) response for the current round of an interactive brainstorm session. " +
      "After the brainstorm tool returns external models' responses, call this tool with your " +
      "substantive contribution. Read all responses carefully and engage with specific points — " +
      "agree, disagree, build upon, or challenge ideas. Do not just summarize. " +
      "After your response, the next round runs automatically (or synthesis if final round).",
    {
      session_id: z
        .string()
        .describe("The session ID returned by the brainstorm tool"),
      response: z
        .string()
        .min(50)
        .describe(
          "Your substantive contribution to this round of the debate. " +
            "Engage deeply with the other models' responses. Minimum 50 characters."
        ),
    },
    async ({ session_id, response }) => {
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

        if (session.status === "complete") {
          return {
            content: [
              {
                type: "text" as const,
                text: "This brainstorm session is already complete. Start a new one with `brainstorm`.",
              },
            ],
            isError: true,
          };
        }

        const onProgress = (msg: string) => {
          console.error(`[brainstorm] ${msg}`);
        };

        const currentRound = session.currentRound;

        // Store Claude's response for the current round
        const claudeResponse: RoundResponse = {
          modelId: "claude:host",
          round: currentRound,
          content: response,
        };
        session.rounds[currentRound - 1].push(claudeResponse);
        session.totalCharsProcessed += response.length;

        onProgress(
          `Round ${currentRound}: claude:host responded (${response.length} chars)`
        );

        // Final round — run synthesis
        if (currentRound >= session.totalRounds) {
          const synthesis = await runSynthesis(
            session.topic,
            session.rounds,
            session.synthesizerIdentifier,
            session.modelIdentifiers,
            onProgress
          );
          session.totalCharsProcessed += synthesis.length;

          const totalDurationMs = Date.now() - session.startTime;
          const allModelIds = [...session.modelIdentifiers, "claude:host"];
          const estimatedTokensVal =
            estimateTokens(session.topic.repeat(session.totalRounds)) +
            Math.ceil(session.totalCharsProcessed / 4);

          const result: DebateResult = {
            topic: session.topic,
            rounds: session.rounds,
            synthesis,
            modelsFailed: Array.from(session.failedModels),
            stats: {
              totalDurationMs,
              estimatedTokens: estimatedTokensVal,
              estimatedCost: estimateCost(allModelIds, estimatedTokensVal),
            },
          };

          session.status = "complete";
          deleteSession(session_id);

          onProgress(
            `Brainstorm complete in ${(totalDurationMs / 1000).toFixed(1)}s. ` +
              `~${estimatedTokensVal.toLocaleString()} tokens, ${result.stats.estimatedCost}`
          );

          return {
            content: [
              { type: "text" as const, text: formatResult(result) },
            ],
          };
        }

        // More rounds — run next round with external models
        const nextRound = currentRound + 1;

        const { responses: nextResponses, failedModels } =
          await runExternalRound(
            session.topic,
            session.modelIdentifiers,
            nextRound,
            session.totalRounds,
            session.rounds,
            session.systemPrompt,
            onProgress
          );

        session.rounds.push(nextResponses);
        session.currentRound = nextRound;
        for (const r of nextResponses)
          session.totalCharsProcessed += r.content.length;
        for (const f of failedModels) session.failedModels.add(f);

        const roundText = formatRoundResponses(nextResponses);
        const remainingRounds = session.totalRounds - nextRound;

        const turnInstruction =
          remainingRounds > 0
            ? `**Your turn (round ${nextRound}).** ` +
              `Read the responses above and refine your position. ` +
              `You have ${remainingRounds} more round(s) after this.`
            : `**Your turn (final round).** ` +
              `This is the FINAL round. Provide your best, refined position. ` +
              `After this, the debate will be synthesized.`;

        return {
          content: [
            {
              type: "text" as const,
              text:
                `## Round ${nextRound} of ${session.totalRounds}\n\n` +
                `### External Model Responses\n\n${roundText}\n` +
                `---\n\n` +
                `${turnInstruction}\n\n` +
                `Call \`brainstorm_respond\` with:\n` +
                `- session_id: "${session_id}"\n` +
                `- response: your contribution\n\n` +
                `Engage with the other models' specific points.`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `brainstorm_respond failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
