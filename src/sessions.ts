import { randomUUID } from "crypto";
import { DebateSession, RoundResponse } from "./types.js";

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_SESSIONS = 50;

const sessions = new Map<string, DebateSession>();

function cleanExpired(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

export function createSession(params: {
  topic: string;
  modelIdentifiers: string[];
  totalRounds: number;
  synthesizerIdentifier: string;
  systemPrompt?: string;
}): DebateSession {
  cleanExpired();

  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort(
      ([, a], [, b]) => a.createdAt - b.createdAt
    )[0];
    if (oldest) sessions.delete(oldest[0]);
  }

  const session: DebateSession = {
    ...params,
    id: randomUUID(),
    createdAt: Date.now(),
    startTime: Date.now(),
    currentRound: 0,
    rounds: [],
    failedModels: new Set<string>(),
    totalCharsProcessed: 0,
    status: "awaiting_host",
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): DebateSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return undefined;
  }
  return session;
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}
