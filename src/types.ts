/**
 * "api" providers talk HTTP to an OpenAI-compatible endpoint (billed per token).
 * "cli" providers shell out to a locally installed agent CLI (claude, codex, ...)
 * so an existing subscription is used instead of API credits.
 */
export type ProviderKind = "api" | "cli";

export interface CliSpec {
  /** Built-in adapter id ("claude", "codex", ...) or "custom" for template args. */
  adapter: string;
  /** Executable to spawn. */
  command: string;
  /** Extra flags appended to every invocation. */
  extraArgs?: string[];
  /** "custom" adapter only: argv template using {{model}}/{{system}}/{{prompt}}/{{outfile}}. */
  args?: string[];
  /** How the prompt reaches the CLI. */
  promptVia?: "arg" | "stdin";
  /** Env vars removed before spawning, so the CLI uses its subscription auth. */
  stripEnv?: string[];
  /**
   * Env vars set for the child, applied after stripEnv. A value of "$NAME"
   * is read from the server's own environment, so tokens stay out of config
   * files. Lets one CLI be pointed at a different backend — e.g. the Claude
   * CLI against a Moonshot/MiniMax/GLM coding plan.
   */
  env?: Record<string, string>;
  /** Adapter writes its final message to a temp file we pass in. */
  usesOutputFile?: boolean;
  timeoutMs?: number;
  cwd?: string;
}

export interface ProviderConfig {
  name: string;
  kind: ProviderKind;
  baseURL: string;
  apiKeyEnvVar: string;
  defaultModel: string;
  cli?: CliSpec;
}

export interface ResolvedModel {
  provider: string;
  modelId: string;
  kind: ProviderKind;
  baseURL: string;
  apiKeyEnvVar: string;
  cli?: CliSpec;
}

export interface RoundResponse {
  modelId: string; // "provider:model" format
  round: number;
  content: string;
  error?: string;
}

export interface DebateResult {
  topic: string;
  rounds: RoundResponse[][];
  synthesis: string;
  modelsFailed: string[];
  stats: DebateStats;
}

export interface DebateStats {
  totalDurationMs: number;
  estimatedTokens: number;
  estimatedCost: string;
}

export type ProgressCallback = (message: string) => void;

export interface DebateSession {
  id: string;
  topic: string;
  modelIdentifiers: string[];
  totalRounds: number;
  currentRound: number;
  rounds: RoundResponse[][];
  synthesizerIdentifier: string;
  systemPrompt?: string;
  failedModels: Set<string>;
  startTime: number;
  createdAt: number;
  totalCharsProcessed: number;
  status: "awaiting_host" | "complete";
  mode?: "hosted";
  hostedPhase?: "round" | "synthesis";
  context?: string;
  style?: "freeform" | "redteam" | "socratic";
}
