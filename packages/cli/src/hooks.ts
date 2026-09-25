import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { diffPackageJson, type DependencyChange } from "@decisionloop/core/domain-packs/engineering";
import { DecisionLoop } from "@decisionloop/sdk";
import { loadConfig, projectDir } from "./config";
import { changedFiles, fileAtRevision, repositoryName } from "./git";

/**
 * Agent lifecycle hooks (spec §12–§13). Reference integration for Claude
 * Code; the same commands work for any agent whose hooks pass JSON on stdin
 * and read context from stdout.
 *
 *   SessionStart      → what is at risk, and how to ask DecisionLoop
 *   UserPromptSubmit  → relevant decisions for the prompt and touched files
 *   PreToolUse        → ask the user before editing files a BLOCKING constraint protects
 *   Stop              → post-flight: nudge the agent to propose decisions it made
 *
 * Rules: never break the agent (every failure exits 0 silently), never
 * flood it (output only when there is something relevant; post-flight
 * nudges once per distinct change set per session), never write memory
 * without a person (proposals go to the approval queue).
 */

interface HookInput {
  session_id?: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; path?: string; notebook_path?: string };
  hook_event_name?: string;
  source?: string;
}

const AGENT = process.env.DECISIONLOOP_AGENT ?? "claude-code";

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    setTimeout(() => resolve(data), 3000);
  });
}

function emit(event: string, additionalContext: string) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }));
}

/** Path-like tokens in a prompt: `src/auth/session.ts`, `packages/core/`. */
export function pathsInPrompt(prompt: string): string[] {
  const found = prompt.match(/(?:^|[\s`'"(])((?:[\w.-]+\/)+[\w.*-]*)/g) ?? [];
  return Array.from(new Set(found.map((m) => m.trim().replace(/^[`'"(]/, "")).filter((p) => p.length > 2 && !p.startsWith("http")))).slice(0, 20);
}

function statePath() {
  return path.join(projectDir(), "hook-state.json");
}

function readState(): Record<string, string[]> {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8")) as Record<string, string[]>;
  } catch {
    return {};
  }
}

function localDependencyChanges(files: string[]): DependencyChange[] {
  return files
    .filter((f) => path.basename(f) === "package.json")
    .flatMap((f) => diffPackageJson(fileAtRevision(f), fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null, f));
}

export async function runHook(args: string[]): Promise<void> {
  const event = args[0];
  try {
    const raw = await readStdin();
    const input = (raw ? JSON.parse(raw) : {}) as HookInput;
    if (input.cwd) process.chdir(input.cwd);
    const cfg = loadConfig();
    const key = cfg.agentKey ?? cfg.apiKey;
    if (!key) return;
    const repository = cfg.project?.repository ?? repositoryName();
    const dl = new DecisionLoop({
      baseUrl: cfg.url,
      apiKey: key,
      timeoutMs: 8000,
      agent: input.session_id ? { name: AGENT, sessionId: input.session_id, repository } : null,
    });

    switch (event) {
      case "session-start": {
        const atRisk = await dl.decisions.atRisk(5);
        const files = changedFiles();
        const lines = [
          "DecisionLoop is connected: it records why this system is built the way it is.",
          "Before significant changes, call decisionloop_get_context with your intent and the files you will touch; after making a decision that will shape future work, call decisionloop_propose_decision.",
        ];
        if (atRisk.length) {
          lines.push(`Decisions currently AT RISK (evidence contradicts their assumptions): ${atRisk.map((r) => `${r.decision.externalRef ?? r.decision.title}`).join(", ")}.`);
        }
        if (files.length) {
          const ctx = await dl.context.get({ intent: "Resume work on uncommitted changes", resources: files.slice(0, 100), repository, agent: AGENT, agentSessionId: input.session_id ?? null });
          if (ctx.decisions.length) lines.push("", ctx.summary);
        }
        emit("SessionStart", lines.join("\n"));
        return;
      }

      case "user-prompt-submit": {
        const prompt = input.prompt ?? "";
        if (prompt.trim().length < 8) return;
        const resources = Array.from(new Set([...pathsInPrompt(prompt), ...changedFiles().slice(0, 50)]));
        const ctx = await dl.context.get({ intent: prompt.slice(0, 2000), resources, repository, maxDecisions: 3, agent: AGENT, agentSessionId: input.session_id ?? null });
        if (ctx.decisions.length === 0) return;
        emit("UserPromptSubmit", ctx.summary);
        return;
      }

      case "pre-tool-use": {
        const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? input.tool_input?.path;
        if (!file) return;
        const rel = path.relative(process.cwd(), path.resolve(file)).replace(/\\/g, "/");
        if (rel.startsWith("..")) return;
        const constraints = await dl.context.constraints([rel], repository);
        const blocking = constraints.filter((c) => c.severity === "BLOCKING");
        if (blocking.length === 0) return;
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "ask",
              permissionDecisionReason: `DecisionLoop: ${rel} is governed by ${blocking
                .map((c) => `${c.decision.externalRef ?? c.decision.title} ("${c.statement}")`)
                .join("; ")}. Confirm this change is intended.`,
            },
          }),
        );
        return;
      }

      case "stop": {
        const files = changedFiles();
        const deps = localDependencyChanges(files);
        if (deps.length === 0 && files.length === 0) return;
        const signature = crypto.createHash("sha256").update(JSON.stringify({ deps, files: files.slice().sort() })).digest("hex").slice(0, 16);
        const sessionKey = input.session_id ?? "unknown";
        const state = readState();
        if (state[sessionKey]?.includes(signature)) return;

        const notes: string[] = [];
        if (deps.length) {
          notes.push(
            `Dependencies changed: ${deps.map((d) => `${d.change === "added" ? "+" : d.change === "removed" ? "-" : "~"}${d.name}`).join(", ")}.`,
          );
        }
        const constraints = files.length ? await dl.context.constraints(files.slice(0, 100), repository) : [];
        const depSubjects = new Set(deps.map((d) => `npm:${d.name.toLowerCase()}`));
        const touched = constraints.filter((c) => {
          const rule = c.rule as { kind?: string; subject?: string };
          return !rule.subject || depSubjects.has(rule.subject.replace(/^package:/, "").toLowerCase()) || rule.kind === "path_protected";
        });
        if (touched.length) {
          notes.push(`These changes touch recorded constraints: ${touched.map((c) => `${c.decision.externalRef ?? c.decision.title} — "${c.statement}"`).join("; ")}.`);
        }
        if (notes.length === 0) return;

        state[sessionKey] = [...(state[sessionKey] ?? []), signature].slice(-20);
        fs.mkdirSync(projectDir(), { recursive: true });
        fs.writeFileSync(statePath(), JSON.stringify(state));
        emit(
          "Stop",
          [
            "DecisionLoop post-flight:",
            ...notes,
            "If this work made or reversed a decision that will shape future work (architecture, dependencies, data, auth, APIs), record it with decisionloop_propose_decision — include rejected alternatives and the assumptions it relies on. A person will review it. Skip this for routine changes.",
          ].join("\n"),
        );
        return;
      }

      default:
        process.stderr.write(`decisionloop hook: unknown event "${event}" (session-start | user-prompt-submit | pre-tool-use | stop)\n`);
    }
  } catch (err) {
    // A hook must never break the agent's session.
    if (process.env.DECISIONLOOP_DEBUG) process.stderr.write(`decisionloop hook ${event}: ${err instanceof Error ? err.message : err}\n`);
  }
}
