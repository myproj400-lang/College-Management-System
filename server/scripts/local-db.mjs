// Runs a real PostgreSQL server for local development, with no system install.
// Data lives in ./.local-db (git-ignored). Stop with Ctrl+C.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';

const dataDir = './.local-db';
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: 5433,
  persistent: true,
});

if (!existsSync(dataDir)) await pg.initialise();
await pg.start();
console.log('Local PostgreSQL running on 127.0.0.1:5433 (user postgres / postgres)');

async function stop() {
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
