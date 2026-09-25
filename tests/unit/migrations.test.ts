import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "@/db/migrate";

/**
 * The statement splitter is load-bearing for CockroachDB: sending a whole
 * migration file as one implicit transaction trips CockroachDB's limits on
 * mixing schema changes and writes. If this breaks, migrations fail against
 * a real cluster but nothing in the app's own type checking notices.
 */

describe("splitSqlStatements", () => {
  it("splits on statement boundaries", () => {
    const statements = splitSqlStatements("CREATE TABLE a (id INT); CREATE TABLE b (id INT);");
    expect(statements).toHaveLength(2);
  });

  it("strips line comments without eating the statement", () => {
    const statements = splitSqlStatements(
      "-- a leading comment\nCREATE TABLE a (id INT); -- trailing\nCREATE TABLE b (id INT);",
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("CREATE TABLE a");
    expect(statements[0]).not.toContain("leading comment");
  });

  it("ignores trailing whitespace and empty segments", () => {
    expect(splitSqlStatements("SELECT 1;\n\n   \n;")).toEqual(["SELECT 1"]);
  });

  it("refuses a $$-quoted body rather than mis-splitting it", () => {
    expect(() =>
      splitSqlStatements("CREATE FUNCTION f() AS $$ SELECT 1; SELECT 2; $$;"),
    ).toThrow(/statement splitter/i);
  });
});

describe("migration files", () => {
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));

  it("has migrations to run", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("splits every migration into at least one statement", () => {
    for (const file of files) {
      const contents = fs.readFileSync(path.join(dir, file), "utf8");
      expect(splitSqlStatements(contents).length).toBeGreaterThan(0);
    }
  });

  it("applies in a stable lexicographic order", () => {
    expect([...files].sort()).toEqual(files.sort());
    expect(files[0]).toMatch(/^0001_/);
  });

  it("includes resumable release hardening for retries and evidence", () => {
    const hardening = fs.readFileSync(
      path.join(dir, "0004_release_hardening.sql"),
      "utf8",
    );
    expect(hardening).toContain("memory_index_status");
    expect(hardening).toContain("commit_key");
    expect(hardening).toContain("dedupe_key");
    expect(hardening).toContain("decision_evidence_document_type_idx");
  });
});

describe("dialect handling", () => {
  it("keeps CockroachDB-only and PostgreSQL-only files on their dialect", async () => {
    const { appliesToDialect } = await import("@decisionloop/storage-sql/migrate");
    expect(appliesToDialect("0002_vector_index.optional.sql", "postgres")).toBe(false);
    expect(appliesToDialect("0002_vector_index.optional.sql", "cockroach")).toBe(true);
    expect(appliesToDialect("0006_pgvector_index.postgres.optional.sql", "cockroach")).toBe(false);
    expect(appliesToDialect("0005_reasoning_infrastructure.sql", "postgres")).toBe(true);
  });

  it("rewrites the historical STRING type only for PostgreSQL", async () => {
    const { adaptStatement } = await import("@decisionloop/storage-sql/migrate");
    expect(adaptStatement("name STRING NOT NULL", "postgres")).toBe("name TEXT NOT NULL");
    expect(adaptStatement("name STRING NOT NULL", "cockroach")).toBe("name STRING NOT NULL");
  });

  it("new migrations are written in portable SQL", () => {
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
    const newer = files.filter((f) => f >= "0005");
    for (const file of newer) {
      const contents = fs.readFileSync(path.join(dir, file), "utf8");
      expect(splitSqlStatements(contents).join("\n"), file).not.toMatch(/\bSTRING\b/);
    }
  });
});
