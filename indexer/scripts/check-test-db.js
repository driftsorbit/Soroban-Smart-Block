// Fails fast with an actionable message when the integration suite has no
// reachable Postgres, instead of letting DB-backed tests hang until killed (#975).
import pg from "pg";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!url) {
  console.error(
    "[test:integration] TEST_DATABASE_URL is not set. Point it at a reachable Postgres, e.g. postgres://postgres:postgres@localhost:5432/soroban_test",
  );
  process.exit(1);
}

const redacted = url.replace(/\/\/[^@]*@/, "//***@");
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });

try {
  await client.connect();
  await client.query("SELECT 1");
  console.log(`[test:integration] Postgres reachable at ${redacted}`);
} catch (err) {
  console.error(`[test:integration] Cannot reach Postgres at ${redacted}: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
