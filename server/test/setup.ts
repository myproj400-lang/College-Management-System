import path from "node:path";
import dotenv from "dotenv";

// Loaded before any test file imports app code, so src/config/env.ts picks
// up the test database/session settings rather than .env's dev values.
dotenv.config({ path: path.join(__dirname, "..", ".env.test"), override: true });
