// Applies prisma/migrations to an empty PostgreSQL and fails if the result
// differs from prisma/schema.prisma. Run after adding a migration.
import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const dataDir = './.verify-db';
const port = 5436;
const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;

rmSync(dataDir, { recursive: true, force: true });
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false });
let failed = false;
try {
  await pg.initialise();
  await pg.start();
  const env = { ...process.env, DATABASE_URL: url };
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env });
  execSync(`npx prisma migrate diff --from-url "${url}" --to-schema-datamodel prisma/schema.prisma --exit-code`, {
    stdio: 'inherit',
    env,
  });
  console.log('Migrations match the schema.');
} catch (err) {
  failed = true;
  console.error(err instanceof Error ? err.message : err);
  console.error('Migrations do NOT match prisma/schema.prisma.');
} finally {
  await pg.stop();
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
