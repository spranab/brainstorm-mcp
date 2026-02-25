export interface ProviderConfig {
  name: string;
  baseURL: string;
  apiKeyEnvVar: string;
  defaultModel: string;
}

export interface ResolvedModel {
  provider: string;
  modelId: string;
  baseURL: string;
  apiKeyEnvVar: string;
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
}
