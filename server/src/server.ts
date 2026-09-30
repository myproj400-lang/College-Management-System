import { config } from './config';
import { createApp } from './app';
import { prisma } from './db';

const server = createApp().listen(config.port, () => {
  console.log(`College Management API listening on http://localhost:${config.port}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
