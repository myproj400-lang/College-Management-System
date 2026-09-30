// Starts a throwaway PostgreSQL for the test run and creates the schema in it.
import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const dataDir = './.test-db';
const port = 5434;

export default async function setup() {
  rmSync(dataDir, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false });
  await pg.initialise();
  await pg.start();

  execSync('npx prisma db push --skip-generate --force-reset', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable` },
  });

  return async () => {
    await pg.stop();
    rmSync(dataDir, { recursive: true, force: true });
  };
}
