// Explicit synthetic fault probe. The host restarts ONLY its owned Compose DB
// after R1_RESTART_READY; this script has no Docker socket or production access.
const { Client } = require("pg");
const {
  applicationPgConfig,
} = require("../../lingua_ai_backend/src/persistence/pg-config.ts");
const {
  ApplicationDatabase,
} = require("../../lingua_ai_backend/src/persistence/application-database.ts");
const {
  ApplicationTransactions,
} = require("../../lingua_ai_backend/src/persistence/application-transaction.ts");
const {
  pgError,
} = require("../../lingua_ai_backend/src/persistence/pg-errors.ts");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  if (
    process.env.APPLICATION_PG_DISPOSABLE !== "true" ||
    !process.env.M3A_RUNTIME_PASSWORD?.startsWith("synthetic-m3a-") ||
    !process.env.M3A_ADMIN_PASSWORD?.startsWith("synthetic-m3a-")
  )
    throw Error("Explicit synthetic fixture required");
  const url = new URL("postgresql://lc_app_runtime@app-postgres/lc_app_m3a");
  url.password = process.env.M3A_RUNTIME_PASSWORD;
  const cfg = applicationPgConfig({
    ...process.env,
    APPLICATION_DATABASE_URL: url.toString(),
    APPLICATION_PG_POOL_MAX: "2",
    APPLICATION_PG_ACQUIRE_MS: "200",
    APPLICATION_PG_STATEMENT_MS: "10000",
  });
  const db = new ApplicationDatabase(cfg),
    tx = new ApplicationTransactions(db);
  const observer = new Client({
    host: "app-postgres",
    database: "lc_app_m3a",
    user: "lc_app_bootstrap",
    password: process.env.M3A_ADMIN_PASSWORD,
    connectionTimeoutMillis: 1000,
    statement_timeout: 1000,
  });
  observer.on("error", () => undefined);
  try {
    if (!(await db.health()))
      throw Error("Foundation must be migrated and ready");
    await observer.connect();
    let pid = 0,
      resolved = false,
      category = null;
    const operation = tx
      .run(
        async (handle) => {
          pid = (await tx.query(handle, "SELECT pg_backend_pid() AS pid"))
            .rows[0].pid;
          await tx.query(handle, "SELECT pg_sleep(30)");
        },
        { timeoutMs: 20000 },
      )
      .then(
        () => {
          resolved = true;
          category = "UNEXPECTED_SUCCESS";
        },
        (error) => {
          resolved = true;
          category = pgError(error).category;
        },
      );
    const readyBy = Date.now() + 5000;
    while (
      !(
        pid &&
        (
          await observer.query(
            "SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event='PgSleep'",
            [pid],
          )
        ).rowCount
      )
    ) {
      if (Date.now() > readyBy || resolved)
        throw Error("In-flight statement not observed");
      await sleep(20);
    }
    await observer.end();
    console.log("R1_RESTART_READY");
    let unavailable = false;
    const recoverBy = Date.now() + 20000;
    while (Date.now() < recoverBy) {
      const healthy = await db.health();
      if (!healthy) unavailable = true;
      if (unavailable && healthy && resolved) {
        await operation;
        if (category !== "CONNECTION" || db.metrics().leased !== 0)
          throw Error("Unexpected transaction recovery");
        console.log(
          JSON.stringify({
            event: "R1_RESTART_PASS",
            inFlight: category,
            unavailable,
            ready: true,
            leased: db.metrics().leased,
          }),
        );
        return;
      }
      await sleep(100);
    }
    throw Error("Bounded restart recovery did not complete");
  } finally {
    await observer.end().catch(() => undefined);
    await db.close();
  }
}
void main().catch(() => {
  console.error("R1_RESTART_FAIL");
  process.exitCode = 1;
});
