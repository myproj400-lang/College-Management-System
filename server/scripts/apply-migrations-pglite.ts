/**
 * PGlite-only migration runner for local dev/test.
 *
 * Why this exists: `prisma migrate deploy`/`db push` each spawn a separate
 * process that opens its own connection to the database. Real PostgreSQL
 * tolerates that; PGlite's wire-protocol server (@electric-sql/pglite-socket
 * 0.2.11) only reliably tolerates exactly one connection for the lifetime
 * of the server process, and does not appear to release the slot cleanly
 * when a separate CLI process's connection ends - a second CLI invocation
 * then fails or crashes the socket server until it is restarted. See
 * server/README.md "Known PGlite limitations" for the full investigation.
 *
 * This script instead opens ONE connection, applies every migration's SQL
 * file in order inside a single Node process, and closes it cleanly - the
 * same shape of interaction that was verified to work reliably.
 *
 * Against a real PostgreSQL server, use `npm run prisma:deploy`
 * (`prisma migrate deploy`) instead; this script is not used there.
 */
import { Client } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const migrationsDir = path.join(__dirname, "..", "prisma", "migrations");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }
  if (!connectionString.includes("sslmode=disable")) {
    throw new Error(
      "DATABASE_URL must include sslmode=disable for PGlite (its socket server has no SSL negotiation support)."
    );
  }

  const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const client = new Client({ connectionString });
  await client.connect();
  console.log(`Connected. Applying ${migrationFolders.length} migration(s)...`);

  try {
    for (const folder of migrationFolders) {
      const sqlPath = path.join(migrationsDir, folder, "migration.sql");
      const sql = readFileSync(sqlPath, "utf8");
      console.log(`Applying ${folder}...`);
      await client.query(sql);
    }
    console.log("All migrations applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
});
