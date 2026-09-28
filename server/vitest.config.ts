import { defineConfig } from "vitest/config";

// The PGlite local test database tolerates exactly one connection at a
// time (see server/README.md "Known PGlite limitations"). Vitest must
// therefore run every test file in one process, sequentially, never in
// parallel workers - otherwise concurrent suites would each try to open
// their own connection and collide. Against a real PostgreSQL server this
// constraint would not be necessary, but the suite is written to work
// either way.
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    fileParallelism: false,
    isolate: false, // reuse one module registry (and one PrismaClient) across all test files
    pool: "forks",
    singleFork: true,
    testTimeout: 15000,
    hookTimeout: 15000,
    setupFiles: ["./test/setup.ts"],
  },
});
