import { DebateResult, RoundResponse } from "./types.js";

export function formatRoundResponses(responses: RoundResponse[]): string {
  const lines: string[] = [];
  for (const resp of responses) {
    lines.push(`### ${resp.modelId}\n`);
    if (resp.error) {
      lines.push(`> **ERROR:** ${resp.error}\n`);
    } else {
      lines.push(`${resp.content}\n`);
    }
  }
  return lines.join("\n");
}

export function formatResult(result: DebateResult): string {
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
