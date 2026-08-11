/**
 * Deletes the demo workspace so `npm run db:seed` can run cleanly again —
 * useful between demo rehearsals.
 *
 * Scoped to the seeded demo tenant by slug. It will not touch any other
 * workspace, and it refuses to run without an explicit confirmation flag so
 * it can't be triggered by a stray npm script.
 *
 * Usage: npx tsx scripts/reset-demo.ts --yes
 */
import "dotenv/config";
import { sql } from "@/db/client";

const DEMO_SLUGS = ["northstar-commerce", "decisionloop-demo"];

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error(
      "Refusing to delete demo data without confirmation.\n" +
        "Re-run with: npx tsx scripts/reset-demo.ts --yes",
    );
    process.exit(1);
  }

  const tenants = (await sql`
    SELECT id, name, slug FROM tenants WHERE slug IN ${sql(DEMO_SLUGS)}
  `) as Array<{ id: string; name: string; slug: string }>;

  if (tenants.length === 0) {
    console.log("No demo workspace found — nothing to reset.");
    await sql.end();
    return;
  }

  for (const tenant of tenants) {
    // Every table in the schema either carries tenant_id with ON DELETE
    // CASCADE or descends from one that does, so this single delete is
    // sufficient — see db/migrations/0001_init.sql and 0003.
    await sql`DELETE FROM tenants WHERE id = ${tenant.id}`;
    console.log(`Deleted workspace "${tenant.name}" (${tenant.slug}) and all its memory.`);
  }

  await sql.end();
  console.log("\nReset complete. Run `npm run db:seed` to recreate the demo.");
}

main().catch(async (err) => {
  console.error("Reset failed:", err);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
