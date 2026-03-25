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

// --- Style-aware prompt helpers ---

export function getRound1System(
  style?: string,
  customSystemPrompt?: string
): string {
  if (customSystemPrompt) return customSystemPrompt;

  switch (style) {
    case "redteam":
      return (
        "You are participating in an adversarial red-team review. " +
        "Your job is to find flaws, risks, and weaknesses in the given topic or proposal. " +
        "Be critical, thorough, and specific. Challenge assumptions, identify edge cases, " +
        "and propose failure scenarios. Do not be agreeable — your value comes from finding " +
        "problems others miss."
      );
    case "socratic":
      return (
        "You are participating in a Socratic dialogue. Rather than stating positions, " +
        "focus on asking probing questions that expose assumptions, contradictions, and gaps " +
        "in reasoning. When you do take a position, defend it by addressing the strongest " +
        "counterarguments. Push for deeper understanding, not consensus."
      );
    default:
      return (
        "You are participating in a multi-model brainstorming debate. " +
        "Provide your best thinking on the given topic. " +
        "Be specific, creative, and substantive."
      );
  }
}

export function getRoundNSystem(
  roundNumber: number,
  totalRounds: number,
  style?: string
): string {
  const base =
    `You are in round ${roundNumber} of ${totalRounds} of a multi-model brainstorming debate. ` +
    `You can see all previous responses from all participants. `;

  switch (style) {
    case "redteam":
      return (
        base +
        "Continue your adversarial analysis. Challenge the strongest arguments from the " +
        "previous round. Look for overlooked risks, unstated assumptions, and potential failure modes. " +
        "If others found valid flaws, acknowledge them and dig deeper."
      );
    case "socratic":
      return (
        base +
        "Continue the Socratic dialogue. Ask deeper questions based on previous responses. " +
        "Challenge the strongest-seeming answers. Push toward fundamental principles and " +
        "uncover hidden assumptions."
      );
    default:
      return (
        base +
        "Build upon the best ideas, challenge weak reasoning, add new perspectives, " +
        "and refine your position. Be specific about what you agree/disagree with and why."
      );
  }
}

export function getSynthesisSystem(style?: string): string {
  const baseInstruction =
    "You are the synthesizer in a multi-model brainstorming debate. " +
    "Produce a structured verdict with exactly these sections:\n\n" +
    "## Recommendation\nOne clear, opinionated recommendation (2-3 sentences max).\n\n" +
    "## Key Tradeoffs\nThe 2-3 most important tradeoffs or considerations (bullet points).\n\n" +
    "## Strongest Disagreement\nThe single most important unresolved disagreement — " +
    "state each side's strongest argument. Do NOT water this down into 'both have merit.'\n\n";

  switch (style) {
    case "redteam":
      return (
        baseInstruction +
        "Focus on which criticisms were valid vs. overblown. " +
        "The recommendation should address the real risks identified."
      );
    case "socratic":
      return (
        baseInstruction +
        "Focus on which questions revealed genuine gaps vs. which were satisfactorily answered. " +
        "The recommendation should reflect the deepest insights uncovered."
      );
    default:
      return (
        baseInstruction +
        "Be thorough but concise. Prioritize actionable insight over comprehensiveness."
      );
  }
}

export function buildEffectiveTopic(
  topic: string,
  context?: string
): string {
  if (!context) return topic;
  return `Context:\n${context}\n\nTopic: ${topic}`;
}

// Rough cost per 1M tokens (input + output blended estimate)
const COST_PER_MILLION: Record<string, number> = {
  "gpt-4o": 5,
  "gpt-4.1": 4,
  "gpt-5": 10,
  "gpt-5-mini": 1.5,
  "gpt-5-nano": 0.5,
  "gpt-5-pro": 30,
  "gpt-5.1": 12,
  "gpt-5.2": 15,
  "gpt-5.2-pro": 40,
  "gpt-5.3-codex": 20,
  "gpt-5.4": 10,
  "gpt-5.4-pro": 50,
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
            max_completion_tokens: 8192,
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

    const choice = response.choices[0];
    const content = choice?.message?.content;
    if (!content) {
      const finishReason = choice?.finish_reason || "unknown";
      const refusal = (choice?.message as any)?.refusal;
      const detail = refusal
        ? `refusal: ${refusal}`
        : `finish_reason: ${finishReason}`;
      throw new Error(
        `Model ${label} returned an empty response (${detail})`
      );
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
    const round1System = getRound1System(undefined, systemPrompt);

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

  const roundSystem = getRoundNSystem(roundNumber, totalRounds);

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
  onProgress?: ProgressCallback,
  style?: string
): Promise<string> {
  const log = onProgress || (() => {});
  const fullHistory = buildHistoryContext(allRounds);

  const synthesisSystem = getSynthesisSystem(style);

  const synthesisUserMessage =
    `Original topic: ${topic}\n\n${fullHistory}\n\n` +
    `Please synthesize the above debate into a structured verdict.`;

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

  const round1System = getRound1System(undefined, systemPrompt);

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

    const roundSystem = getRoundNSystem(r, rounds);

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

  const synthesisSystem = getSynthesisSystem();

  const synthesisUserMessage =
    `Original topic: ${topic}\n\n${fullHistory}\n\n` +
    `Please synthesize the above debate into a structured verdict.`;

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
