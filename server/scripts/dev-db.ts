/**
 * Local development/test database for environments without Docker or an
 * installable PostgreSQL server. PGlite is a real Postgres engine compiled
 * to run embedded; pglite-socket serves it over the genuine Postgres wire
 * protocol on a local TCP port, so Prisma and the rest of the application
 * connect with an ordinary postgresql:// URL and no code changes.
 *
 * For staging/production, point DATABASE_URL at a real managed PostgreSQL
 * instance instead - this script is dev/test tooling only, never a
 * production dependency.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import path from "node:path";

const dataDir = path.join(__dirname, "..", process.env.PGLITE_DATA_DIR ?? ".pglite-data");
const port = Number(process.env.PGLITE_PORT ?? 5433);

async function main() {
  const db = new PGlite(dataDir);
  await db.waitReady;
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await server.start();
  // eslint-disable-next-line no-console
  console.log(`PGlite database ready - postgres wire protocol on 127.0.0.1:${port}, data dir: ${dataDir}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start PGlite database:", err);
  process.exit(1);
});
