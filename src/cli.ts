import { spawn } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { CliSpec } from "./types.js";

const DEFAULT_CLI_TIMEOUT_MS = Number(
  process.env.BRAINSTORM_CLI_TIMEOUT_MS || 300_000
);

/** Model id that means "let the CLI pick its own configured default". */
export const CLI_DEFAULT_MODEL = "default";

interface CliCallContext {
  /** Undefined when the caller asked for the CLI's own default model. */
  model?: string;
  system: string;
  prompt: string;
  /** Absolute path the adapter should write its final message to. */
  outFile?: string;
}

interface BuiltinCli {
  command: string;
  /** Default model identifier exposed as `<provider>:<defaultModel>`. */
  defaultModel: string;
  promptVia: "arg" | "stdin";
  usesOutputFile?: boolean;
  /**
   * Env vars stripped before spawning. Agent CLIs prefer an API key over the
   * logged-in subscription when one is present, which is exactly what we are
   * trying to avoid paying for here.
   */
  stripEnv?: string[];
  /** false when the flags are modelled on docs rather than a verified local run. */
  verified: boolean;
  /** Human-readable note shown by list_providers. */
  note?: string;
  buildArgs(ctx: CliCallContext): string[];
}

function modelFlag(flag: string, model?: string): string[] {
  return model ? [flag, model] : [];
}

/**
 * CLIs without a system-prompt flag get the system message folded into the
 * user prompt instead.
 */
function prependSystem(ctx: CliCallContext): string {
  return ctx.system ? `${ctx.system}\n\n---\n\n${ctx.prompt}` : ctx.prompt;
}

export const BUILTIN_CLIS: Record<string, BuiltinCli> = {
  claude: {
    command: "claude",
    defaultModel: "sonnet",
    promptVia: "stdin",
    stripEnv: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
    verified: true,
    buildArgs: (ctx) => [
      "-p",
      "--output-format",
      "text",
      "--no-session-persistence",
      // Pure text generation: no tool use, no permission prompts, no repo edits.
      // The `=` form matters — `--tools ""` is variadic and would swallow
      // whatever argument comes next.
      "--tools=",
      ...modelFlag("--model", ctx.model),
      ...(ctx.system ? ["--system-prompt", ctx.system] : []),
    ],
  },

  codex: {
    command: "codex",
    defaultModel: CLI_DEFAULT_MODEL,
    promptVia: "stdin",
    usesOutputFile: true,
    stripEnv: ["OPENAI_API_KEY"],
    verified: true,
    buildArgs: (ctx) => [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--color",
      "never",
      "-s",
      "read-only",
      ...modelFlag("-m", ctx.model),
      ...(ctx.outFile ? ["-o", ctx.outFile] : []),
    ],
  },

  gemini: {
    command: "gemini",
    defaultModel: "gemini-2.5-pro",
    promptVia: "arg",
    verified: false,
    note: "flags modelled on Gemini CLI docs; verify locally",
    buildArgs: (ctx) => [...modelFlag("-m", ctx.model), "-p", prependSystem(ctx)],
  },

  qwen: {
    command: "qwen",
    defaultModel: "qwen3-coder-plus",
    promptVia: "arg",
    verified: false,
    note: "Qwen Code (Gemini-CLI fork); flags assumed identical, verify locally",
    buildArgs: (ctx) => [...modelFlag("-m", ctx.model), "-p", prependSystem(ctx)],
  },

  kimi: {
    command: "kimi",
    defaultModel: CLI_DEFAULT_MODEL,
    promptVia: "arg",
    verified: false,
    note: "Moonshot Kimi CLI; flags modelled on docs, verify locally",
    buildArgs: (ctx) => [
      "--print",
      ...modelFlag("--model", ctx.model),
      prependSystem(ctx),
    ],
  },

  "cursor-agent": {
    command: "cursor-agent",
    defaultModel: CLI_DEFAULT_MODEL,
    promptVia: "arg",
    verified: false,
    note: "flags modelled on Cursor CLI docs; verify locally",
    buildArgs: (ctx) => [
      "-p",
      "--output-format",
      "text",
      ...modelFlag("--model", ctx.model),
      prependSystem(ctx),
    ],
  },

  opencode: {
    command: "opencode",
    defaultModel: CLI_DEFAULT_MODEL,
    promptVia: "arg",
    verified: false,
    note: "model ids are 'provider/model'; verify locally",
    buildArgs: (ctx) => [
      "run",
      ...modelFlag("-m", ctx.model),
      prependSystem(ctx),
    ],
  },

  droid: {
    command: "droid",
    defaultModel: CLI_DEFAULT_MODEL,
    promptVia: "arg",
    verified: false,
    note: "Factory CLI; flags modelled on docs, verify locally",
    buildArgs: (ctx) => [
      "exec",
      "--output-format",
      "text",
      ...modelFlag("-m", ctx.model),
      prependSystem(ctx),
    ],
  },
};

/** Adapter ids that are auto-registered when found on PATH. */
export const AUTODETECT_ORDER = [
  "claude",
  "codex",
  "gemini",
  "cursor-agent",
  "opencode",
  "qwen",
  "kimi",
  "droid",
];

/**
 * Resolve a bare command name against PATH. Absolute/relative paths are
 * checked directly.
 */
export function commandExists(command: string): boolean {
  const isExecutable = (p: string) => {
    try {
      accessSync(p, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };

  if (command.includes("/")) return existsSync(command) && isExecutable(command);

  const path = process.env.PATH || "";
  for (const dir of path.split(delimiter).filter(Boolean)) {
    const full = join(dir, command);
    if (existsSync(full) && isExecutable(full)) return true;
  }
  return false;
}

/** Build the full CliSpec for a built-in adapter, applying config overrides. */
export function specForAdapter(
  adapter: string,
  overrides: Partial<CliSpec> = {}
): CliSpec {
  const builtin = BUILTIN_CLIS[adapter];
  if (!builtin) {
    throw new Error(
      `Unknown CLI adapter "${adapter}". Known: ${Object.keys(BUILTIN_CLIS).join(", ")}, custom`
    );
  }
  return {
    adapter,
    command: builtin.command,
    promptVia: builtin.promptVia,
    usesOutputFile: builtin.usesOutputFile,
    stripEnv: builtin.stripEnv,
    ...overrides,
  };
}

/**
 * Backends reachable by pointing the Claude CLI at a vendor's
 * Anthropic-compatible endpoint. Useful when a coding-plan subscription is
 * cheaper than that vendor's metered API.
 */
export const CLAUDE_CLI_BACKENDS: Record<
  string,
  { baseURL: string; tokenEnv: string; defaultModel: string }
> = {
  moonshot: {
    baseURL: "https://api.moonshot.ai/anthropic",
    tokenEnv: "MOONSHOT_API_KEY",
    defaultModel: "kimi-k2-thinking",
  },
  minimax: {
    baseURL: "https://api.minimax.io/anthropic",
    tokenEnv: "MINIMAX_API_KEY",
    defaultModel: "MiniMax-M2",
  },
  glm: {
    baseURL: "https://api.z.ai/api/anthropic",
    tokenEnv: "ZAI_API_KEY",
    defaultModel: "glm-4.6",
  },
};

/** Build a CLI spec that drives the `claude` binary against another backend. */
export function specForClaudeBackend(backend: string): CliSpec {
  const cfg = CLAUDE_CLI_BACKENDS[backend];
  if (!cfg) {
    throw new Error(
      `Unknown Claude CLI backend "${backend}". Known: ${Object.keys(CLAUDE_CLI_BACKENDS).join(", ")}`
    );
  }
  return {
    ...specForAdapter("claude"),
    env: {
      ANTHROPIC_BASE_URL: cfg.baseURL,
      ANTHROPIC_AUTH_TOKEN: `$${cfg.tokenEnv}`,
    },
  };
}

// ESC [ ... final-byte — CSI sequences some CLIs emit even with NO_COLOR set.
const ANSI_PATTERN = new RegExp("\\u001B\\[[0-9;?]*[ -/]*[@-~]", "g");

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function applyTemplate(args: string[], ctx: CliCallContext): string[] {
  const values: Record<string, string> = {
    model: ctx.model || "",
    system: ctx.system,
    prompt: ctx.prompt,
    outfile: ctx.outFile || "",
  };

  const out: string[] = [];
  for (const arg of args) {
    const exact = /^\{\{(\w+)\}\}$/.exec(arg);
    // A lone placeholder that resolves to nothing drops out of argv along with
    // the flag introducing it, so `["-m", "{{model}}"]` degrades cleanly when
    // no model is pinned.
    if (exact && !values[exact[1]]) {
      if (out.length && out[out.length - 1].startsWith("-")) out.pop();
      continue;
    }
    out.push(arg.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? ""));
  }
  return out;
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

function spawnCli(
  spec: CliSpec,
  args: string[],
  stdinData: string | undefined,
  timeoutMs: number
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of spec.stripEnv || []) delete env[key];
    // Applied after stripEnv so an explicit backend override wins.
    for (const [key, value] of Object.entries(spec.env || {})) {
      // "$NAME" indirects through our own environment — keeps tokens out of
      // brainstorm.config.json.
      const resolved = value.startsWith("$")
        ? process.env[value.slice(1)]
        : value;
      if (resolved) env[key] = resolved;
      else delete env[key];
    }
    // Keep the CLI from trying to render progress UI into our pipe.
    env.NO_COLOR = "1";
    env.CI = env.CI || "1";

    const child = spawn(spec.command, args, {
      cwd: spec.cwd || process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new Error(
            `CLI "${spec.command}" not found on PATH. Install it or remove the provider.`
          )
        );
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });

    if (stdinData !== undefined) {
      child.stdin.on("error", () => {
        // CLI closed stdin early — the close handler reports the real failure.
      });
      child.stdin.end(stdinData);
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Run one prompt through a locally installed agent CLI and return its text.
 */
export async function callCliModel(
  spec: CliSpec,
  modelId: string,
  label: string,
  systemMessage: string,
  userMessage: string,
  timeoutMs?: number
): Promise<string> {
  const effectiveTimeout =
    timeoutMs ?? spec.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  const model =
    !modelId || modelId === CLI_DEFAULT_MODEL ? undefined : modelId;

  let tmpDir: string | undefined;
  let outFile: string | undefined;
  if (spec.usesOutputFile) {
    tmpDir = mkdtempSync(join(tmpdir(), "brainstorm-cli-"));
    outFile = join(tmpDir, "last-message.txt");
  }

  const ctx: CliCallContext = {
    model,
    system: systemMessage,
    prompt: userMessage,
    outFile,
  };

  try {
    let args: string[];
    let stdinData: string | undefined;

    if (spec.adapter === "custom") {
      if (!spec.args?.length) {
        throw new Error(
          `Provider "${label}" uses adapter "custom" but has no args template.`
        );
      }
      args = applyTemplate(spec.args, ctx);
      stdinData =
        spec.promptVia === "stdin" ? prependSystem(ctx) : undefined;
    } else {
      const builtin = BUILTIN_CLIS[spec.adapter];
      if (!builtin) {
        throw new Error(`Unknown CLI adapter "${spec.adapter}" for ${label}`);
      }
      args = builtin.buildArgs(ctx);
      // Adapters with a system flag already consumed it in buildArgs; the
      // stdin-fed ones without one get the folded prompt.
      stdinData =
        (spec.promptVia ?? builtin.promptVia) === "stdin"
          ? spec.adapter === "claude"
            ? userMessage
            : prependSystem(ctx)
          : undefined;
    }

    if (spec.extraArgs?.length) args = [...args, ...spec.extraArgs];

    const result = await spawnCli(spec, args, stdinData, effectiveTimeout);

    if (result.timedOut) {
      throw new Error(
        `Model ${label} timed out after ${Math.round(effectiveTimeout / 1000)}s (CLI: ${spec.command})`
      );
    }

    let text = stripAnsi(result.stdout).trim();

    if (outFile && existsSync(outFile)) {
      const fromFile = stripAnsi(readFileSync(outFile, "utf-8")).trim();
      if (fromFile) text = fromFile;
    }

    if (result.code !== 0) {
      const detail = stripAnsi(result.stderr).trim().slice(-600) || text.slice(-600);
      throw new Error(
        `CLI ${spec.command} exited with code ${result.code} for ${label}${detail ? `: ${detail}` : ""}`
      );
    }

    if (!text) {
      const detail = stripAnsi(result.stderr).trim().slice(-400);
      throw new Error(
        `Model ${label} returned an empty response from ${spec.command}${detail ? ` (stderr: ${detail})` : ""}`
      );
    }

    return text;
  } finally {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  }
}
