#!/usr/bin/env node
// Launcher for the TypeScript CLI until the packages are published as built
// JavaScript. `npm link` in a clone of DecisionLoop puts `decisionloop` on
// PATH; stdio is inherited, so `decisionloop mcp` and hooks work unchanged.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  process.execPath,
  [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), path.join(root, "packages", "cli", "src", "bin.ts"), ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json"),
      DECISIONLOOP_MIGRATIONS_DIR: process.env.DECISIONLOOP_MIGRATIONS_DIR ?? path.join(root, "db", "migrations"),
      DECISIONLOOP_WEB_DIR: process.env.DECISIONLOOP_WEB_DIR ?? root,
    },
  },
);
process.exit(result.status ?? 1);
