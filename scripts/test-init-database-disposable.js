import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import mysql from "mysql2/promise";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, "server", ".env");
const initScriptPath = path.join(projectRoot, "scripts", "init-database.js");
const disposableDatabase = "ai_english_friend_setup_test";
const expectedTables = [
  "ai_personas",
  "conversations",
  "memories",
  "messages",
  "user_persona_settings",
  "user_settings",
  "users",
];

function readEnv(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("export ")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const env = readEnv(envPath);
let connection;
let testDatabaseOwned = false;

try {
  assert(env.DB_NAME === "ai_english_friend", "server/.env must target ai_english_friend for this disposable test.");
  connection = await mysql.createConnection({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    connectTimeout: 5000,
  });

  const [existingRows] = await connection.query(
    "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
    [disposableDatabase],
  );
  assert(existingRows.length === 0, `${disposableDatabase} already exists; refusing to touch it.`);
  testDatabaseOwned = true;

  const firstRun = spawnSync(process.execPath, [initScriptPath, "--database", disposableDatabase], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  assert(firstRun.status === 0, `Fresh disposable initialization failed with exit code ${firstRun.status}.`);

  const [tableRows] = await connection.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
    [disposableDatabase],
  );
  const actualTables = tableRows.map((row) => row.TABLE_NAME);
  assert(JSON.stringify(actualTables) === JSON.stringify(expectedTables), `Expected exactly 7 baseline tables, got: ${actualTables.join(", ")}.`);
  console.log(`[DB TEST] First initialization created exactly 7 tables: ${actualTables.join(", ")}`);

  const rowCountsBefore = {};
  for (const tableName of expectedTables) {
    const [rows] = await connection.query("SELECT COUNT(*) AS row_count FROM ??", [`${disposableDatabase}.${tableName}`]);
    rowCountsBefore[tableName] = Number(rows[0].row_count);
  }
  assert(Object.values(rowCountsBefore).every((count) => count === 0), "Fresh baseline contains unexpected data.");

  const secondRun = spawnSync(process.execPath, [initScriptPath, "--database", disposableDatabase], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  assert(secondRun.status === 5, `Second initialization should refuse with exit code 5, got ${secondRun.status}.`);
  console.log("[DB TEST] Second initialization refused because the database is non-empty.");

  const [tableRowsAfter] = await connection.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
    [disposableDatabase],
  );
  assert(JSON.stringify(tableRowsAfter.map((row) => row.TABLE_NAME)) === JSON.stringify(expectedTables), "Table set changed after refusal.");
  for (const tableName of expectedTables) {
    const [rows] = await connection.query("SELECT COUNT(*) AS row_count FROM ??", [`${disposableDatabase}.${tableName}`]);
    assert(Number(rows[0].row_count) === rowCountsBefore[tableName], `Data changed in ${tableName} after refusal.`);
  }
  console.log("[DB TEST] Core tables and row counts were unchanged after the refusal.");
  console.log("[DB TEST] Disposable database verification passed.");
} catch (error) {
  console.error(`[DB TEST] ${error.message}`);
  process.exitCode = 1;
} finally {
  if (connection && testDatabaseOwned) {
    await connection.query(`DROP DATABASE IF EXISTS \`${disposableDatabase}\``).catch((error) => {
      console.error(`[DB TEST] Cleanup failed for ${disposableDatabase}: ${error.message}`);
      process.exitCode = 1;
    });
    const [remainingRows] = await connection.query(
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
      [disposableDatabase],
    );
    if (remainingRows.length > 0) {
      console.error(`[DB TEST] Cleanup verification failed: ${disposableDatabase} still exists.`);
      process.exitCode = 1;
    } else {
      console.log(`[DB TEST] Removed only disposable database ${disposableDatabase}.`);
    }
  }
  if (connection) await connection.end().catch(() => {});
}
