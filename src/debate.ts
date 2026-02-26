import OpenAI from "openai";
import { getClient } from "./client.js";
import { resolveModel } from "./models.js";
import {
  ResolvedModel,
  RoundResponse,
  DebateResult,
  DebateStats,
  ProgressCallback,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes per model call
const MAX_CONTEXT_CHARS = 12_000; // truncate history per response beyond this

// Rough cost per 1M tokens (input + output blended estimate)
const COST_PER_MILLION: Record<string, number> = {
  "gpt-4o": 5,
  "gpt-4.1": 4,
  "gpt-5.2": 15,
  "o3": 20,
  "o4-mini": 2,
  "deepseek-chat": 0.5,
  "deepseek-reasoner": 2,
  "gemini-2.5-pro": 5,
  "gemini-2.5-flash": 0.5,
  "gemini-2.0-flash": 0.3,
};
const DEFAULT_COST_PER_MILLION = 3;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateCost(models: string[], totalTokens: number): string {
  let totalCostPerMillion = 0;
  for (const id of models) {
    const modelName = id.split(":")[1] || id;
    totalCostPerMillion +=
      COST_PER_MILLION[modelName] ?? DEFAULT_COST_PER_MILLION;
  }
  const avgCostPerMillion = totalCostPerMillion / models.length;
  const cost = (totalTokens / 1_000_000) * avgCostPerMillion;
  return `~$${cost.toFixed(4)}`;
}

async function callModel(
  model: ResolvedModel,
  label: string,
  systemMessage: string,
  userMessage: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const client = getClient(model);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const useNewTokenParam =
      /^(gpt-5|o[0-9])/.test(model.modelId);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemMessage },
      { role: "user", content: userMessage },
    ];

    const response = useNewTokenParam
      ? await client.chat.completions.create(
          {
            model: model.modelId,
            messages,
            temperature: 0.7,
            max_completion_tokens: 4096,
          },
          { signal: controller.signal }
        )
      : await client.chat.completions.create(
          {
            model: model.modelId,
            messages,
            temperature: 0.7,
            max_tokens: 4096,
          },
          { signal: controller.signal }
        );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error(`Model ${label} returned an empty response`);
    }
    return content;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("aborted"))
    ) {
      throw new Error(
        `Model ${label} timed out after ${Math.round(timeoutMs / 1000)}s`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build history context from previous rounds, truncating individual
 * responses if the total would exceed context limits.
 */
export function buildHistoryContext(rounds: RoundResponse[][]): string {
  const sections: string[] = [];

  let totalChars = 0;
  for (const round of rounds) {
    for (const resp of round) {
      totalChars += resp.content.length;
    }
  }

  const totalResponses = rounds.reduce((n, r) => n + r.length, 0);
  const needsTruncation = totalChars > MAX_CONTEXT_CHARS;
  const maxPerResponse = needsTruncation
    ? Math.floor(MAX_CONTEXT_CHARS / Math.max(totalResponses, 1))
    : Infinity;

  for (let r = 0; r < rounds.length; r++) {
    const roundLines: string[] = [`--- Round ${r + 1} ---`];
    for (const resp of rounds[r]) {
      if (resp.error) {
        roundLines.push(`[${resp.modelId}] (FAILED: ${resp.error})\n`);
      } else {
        let content = resp.content;
        if (content.length > maxPerResponse) {
          content =
            content.slice(0, maxPerResponse) +
            "\n[...truncated for context limits]";
        }
        roundLines.push(`[${resp.modelId}]:\n${content}\n`);
      }
    }
    sections.push(roundLines.join("\n"));
  }

  return `=== Previous Responses ===\n\n${sections.join("\n\n")}`;
}

function collectRoundResponses(
  results: PromiseSettledResult<string>[],
  models: { resolved: ResolvedModel; label: string }[],
  round: number,
  failedSet: Set<string>
): RoundResponse[] {
  return results.map((result, idx) => {
    const label = models[idx].label;
    if (result.status === "fulfilled") {
      return { modelId: label, round, content: result.value };
    } else {
      const errMsg =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      failedSet.add(label);
      return { modelId: label, round, content: "", error: errMsg };
    }
  });
}

/**
 * Run a single round with external models. Used by the interactive flow.
 */
export async function runExternalRound(
  topic: string,
  modelIdentifiers: string[],
  roundNumber: number,
  totalRounds: number,
  previousRounds: RoundResponse[][],
  systemPrompt?: string,
  onProgress?: ProgressCallback
): Promise<{ responses: RoundResponse[]; failedModels: string[] }> {
  const log = onProgress || (() => {});
  const failedSet = new Set<string>();

  const models = modelIdentifiers.map((id) => ({
    resolved: resolveModel(id),
    label: id,
  }));

  log(
    `Round ${roundNumber}/${totalRounds}: ${models.map((m) => m.label).join(", ")} responding...`
  );

  if (roundNumber === 1) {
    const round1System =
      systemPrompt ||
      "You are participating in a multi-model brainstorming debate. " +
        "Provide your best thinking on the given topic. " +
        "Be specific, creative, and substantive.";

    const results = await Promise.allSettled(
      models.map((m) => callModel(m.resolved, m.label, round1System, topic))
    );
    const responses = collectRoundResponses(results, models, roundNumber, failedSet);

    for (const r of responses) {
      if (r.error) {
        log(`Round ${roundNumber}: ${r.modelId} failed — ${r.error}`);
      } else {
        log(`Round ${roundNumber}: ${r.modelId} responded (${r.content.length} chars)`);
      }
    }

    return { responses, failedModels: Array.from(failedSet) };
  }

  // Rounds 2+: refinement with full history
  const history = buildHistoryContext(previousRounds);

  const roundSystem =
    `You are in round ${roundNumber} of ${totalRounds} of a multi-model brainstorming debate. ` +
    `You can see all previous responses from all participants (including the host AI). ` +
    `Build upon the best ideas, challenge weak reasoning, add new perspectives, ` +
    `and refine your position. Be specific about what you agree/disagree with and why.`;

  const roundUserMessage =
    `Original topic: ${topic}\n\n${history}\n\n` +
    `Now provide your refined response for round ${roundNumber}. Consider all perspectives above.`;

  const results = await Promise.allSettled(
    models.map((m) =>
      callModel(m.resolved, m.label, roundSystem, roundUserMessage)
    )
  );
  const responses = collectRoundResponses(results, models, roundNumber, failedSet);

  for (const r of responses) {
    if (r.error) {
      log(`Round ${roundNumber}: ${r.modelId} failed — ${r.error}`);
    } else {
      log(`Round ${roundNumber}: ${r.modelId} responded (${r.content.length} chars)`);
    }
  }

  return { responses, failedModels: Array.from(failedSet) };
}

/**
 * Run the synthesis step. Used by the interactive flow after all rounds.
 */
export async function runSynthesis(
  topic: string,
  allRounds: RoundResponse[][],
  synthesizerIdentifier: string,
  modelIdentifiers: string[],
  onProgress?: ProgressCallback
): Promise<string> {
  const log = onProgress || (() => {});
  const fullHistory = buildHistoryContext(allRounds);

  const synthesisSystem =
    "You are the synthesizer in a multi-model brainstorming debate. " +
    "Create a comprehensive, well-organized final output that: " +
    "(1) Identifies the strongest ideas and points of consensus, " +
    "(2) Notes important points of disagreement and why they matter, " +
    "(3) Provides a clear, actionable conclusion. " +
    "Be thorough but concise.";

  const synthesisUserMessage =
    `Original topic: ${topic}\n\n${fullHistory}\n\n` +
    `Please synthesize the above debate into a comprehensive final output.`;

  log(`Synthesizing final output using ${synthesizerIdentifier}...`);

  try {
    const synthesizerModel = resolveModel(synthesizerIdentifier);
    return await callModel(
      synthesizerModel,
      synthesizerIdentifier,
      synthesisSystem,
      synthesisUserMessage
    );
  } catch {
    log(`Synthesizer ${synthesizerIdentifier} failed, trying fallback models...`);
    // Try fallback models
    for (const id of modelIdentifiers) {
      if (id === synthesizerIdentifier) continue;
      try {
        const fallback = resolveModel(id);
        const result = await callModel(
          fallback,
          id,
          synthesisSystem,
          synthesisUserMessage
        );
        log(`Synthesis completed by fallback model ${id}`);
        return result;
      } catch {
        continue;
      }
    }
    return (
      "Synthesis failed — all models encountered errors during the synthesis step. " +
      "Please review the raw debate rounds above."
    );
  }
}

/**
 * Run a complete non-interactive debate. Used when participate=false.
 */
export async function runDebate(
  topic: string,
  modelIdentifiers: string[],
  rounds: number,
  synthesizerIdentifier?: string,
  systemPrompt?: string,
  onProgress?: ProgressCallback
): Promise<DebateResult> {
  const startTime = Date.now();
  const log = onProgress || (() => {});
  let totalCharsProcessed = 0;

  const models: { resolved: ResolvedModel; label: string }[] = [];
  for (const id of modelIdentifiers) {
    models.push({ resolved: resolveModel(id), label: id });
  }

  const synthesizerLabel = synthesizerIdentifier || modelIdentifiers[0];
  const synthesizerModel = resolveModel(synthesizerLabel);

  const estimatedTokensPerRound = models.length * 4096;
  const inputTokensEstimate = models.length * estimateTokens(topic) * rounds;
  const totalEstTokens =
    estimatedTokensPerRound * (rounds + 1) + inputTokensEstimate;
  const estCost = estimateCost(modelIdentifiers, totalEstTokens);

  log(
    `Starting brainstorm: ${models.length} models, ${rounds} rounds. Estimated cost: ${estCost}`
  );

  const allRounds: RoundResponse[][] = [];
  const failedSet = new Set<string>();

  // Round 1
  log(
    `Round 1/${rounds}: ${models.map((m) => m.label).join(", ")} responding...`
  );

  const round1System =
    systemPrompt ||
    "You are participating in a multi-model brainstorming debate. " +
      "Provide your best thinking on the given topic. " +
      "Be specific, creative, and substantive.";

  const round1Results = await Promise.allSettled(
    models.map((m) => callModel(m.resolved, m.label, round1System, topic))
  );

  const round1Responses = collectRoundResponses(
    round1Results,
    models,
    1,
    failedSet
  );
  allRounds.push(round1Responses);

  for (const r of round1Responses) {
    totalCharsProcessed += r.content.length;
    if (r.error) {
      log(`Round 1: ${r.modelId} failed — ${r.error}`);
    } else {
      log(`Round 1: ${r.modelId} responded (${r.content.length} chars)`);
    }
  }

  // Rounds 2-N
  for (let r = 2; r <= rounds; r++) {
    log(
      `Round ${r}/${rounds}: ${models.map((m) => m.label).join(", ")} refining...`
    );

    const history = buildHistoryContext(allRounds);

    const roundSystem =
      `You are in round ${r} of ${rounds} of a multi-model brainstorming debate. ` +
      `You can see all previous responses from all participants. ` +
      `Build upon the best ideas, challenge weak reasoning, add new perspectives, ` +
      `and refine your position. Be specific about what you agree/disagree with and why.`;

    const roundUserMessage =
      `Original topic: ${topic}\n\n${history}\n\n` +
      `Now provide your refined response for round ${r}. Consider all perspectives above.`;

    const roundResults = await Promise.allSettled(
      models.map((m) =>
        callModel(m.resolved, m.label, roundSystem, roundUserMessage)
      )
    );

    const roundResponses = collectRoundResponses(
      roundResults,
      models,
      r,
      failedSet
    );
    allRounds.push(roundResponses);

    for (const resp of roundResponses) {
      totalCharsProcessed += resp.content.length;
      if (resp.error) {
        log(`Round ${r}: ${resp.modelId} failed — ${resp.error}`);
      } else {
        log(
          `Round ${r}: ${resp.modelId} responded (${resp.content.length} chars)`
        );
      }
    }
  }

  // Synthesis
  log(`Synthesizing final output using ${synthesizerLabel}...`);

  const fullHistory = buildHistoryContext(allRounds);

  const synthesisSystem =
    "You are the synthesizer in a multi-model brainstorming debate. " +
    "Create a comprehensive, well-organized final output that: " +
    "(1) Identifies the strongest ideas and points of consensus, " +
    "(2) Notes important points of disagreement and why they matter, " +
    "(3) Provides a clear, actionable conclusion. " +
    "Be thorough but concise.";

  const synthesisUserMessage =
    `Original topic: ${topic}\n\n${fullHistory}\n\n` +
    `Please synthesize the above debate into a comprehensive final output.`;

  let synthesis: string;
  try {
    synthesis = await callModel(
      synthesizerModel,
      synthesizerLabel,
      synthesisSystem,
      synthesisUserMessage
    );
    totalCharsProcessed += synthesis.length;
  } catch {
    log(
      `Synthesizer ${synthesizerLabel} failed, trying fallback models...`
    );
    synthesis = "";
    for (const m of models) {
      if (m.label === synthesizerLabel) continue;
      try {
        synthesis = await callModel(
          m.resolved,
          m.label,
          synthesisSystem,
          synthesisUserMessage
        );
        totalCharsProcessed += synthesis.length;
        log(`Synthesis completed by fallback model ${m.label}`);
        break;
      } catch {
        continue;
      }
    }
    if (!synthesis) {
      synthesis =
        "Synthesis failed — all models encountered errors during the synthesis step. " +
        "Please review the raw debate rounds above.";
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const estimatedTokens = estimateTokens(
    topic.repeat(rounds) + totalCharsProcessed.toString()
  ) + Math.ceil(totalCharsProcessed / 4);

  const stats: DebateStats = {
    totalDurationMs,
    estimatedTokens,
    estimatedCost: estimateCost(modelIdentifiers, estimatedTokens),
  };

  log(
    `Brainstorm complete in ${(totalDurationMs / 1000).toFixed(1)}s. ` +
      `~${estimatedTokens.toLocaleString()} tokens, ${stats.estimatedCost}`
  );

  return {
    topic,
    rounds: allRounds,
    synthesis,
    modelsFailed: Array.from(failedSet),
    stats,
  };
}
