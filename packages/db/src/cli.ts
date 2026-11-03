import { connect, migrate, resetDatabase } from "./migrate.js";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const cmd = process.argv[2] ?? "migrate";
const sql = connect(url, 1);
try {
  if (cmd === "reset") {
    if (process.env["ALLOW_DB_RESET"] !== "1") throw new Error("set ALLOW_DB_RESET=1 to reset (dev/test only)");
    await resetDatabase(sql, { allowDestructive: true });
    console.log("schema reset");
  }
  if (cmd === "migrate" || cmd === "reset") {
    const r = await migrate(sql);
    console.log(`applied: [${r.applied.join(", ")}] skipped: [${r.skipped.join(", ")}]`);
  } else if (cmd !== "reset") {
    throw new Error(`unknown command ${cmd}`);
  }
} finally {
  await sql.end();
}
