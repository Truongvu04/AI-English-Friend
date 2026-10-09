import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, "server", ".env");

function readEnv(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("export ")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function isPlaceholder(value) {
  return !value || /^(your_|change_me|replace_me|example_|password_here|username_here)/i.test(value) || /your_mysql|your_password|replace_me/i.test(value);
}

function output(result) {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(`[DB] ${result.status}: ${result.message}`);
  if (result.databaseExists !== undefined) console.log(`[DB] Database exists: ${result.databaseExists}`);
  if (result.tableCount !== undefined) console.log(`[DB] Table count: ${result.tableCount}`);
}

const env = readEnv(envPath);
const required = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"];
const missing = required.filter((key) => isPlaceholder(env[key]));
if (!fs.existsSync(envPath)) {
  output({ status: "INCOMPLETE", message: "server/.env is missing.", databaseExists: false });
  process.exit(2);
}
if (missing.length > 0) {
  output({ status: "INCOMPLETE", message: `Database configuration is incomplete (${missing.join(", ")}).`, databaseExists: false });
  process.exit(2);
}

let connection;
try {
  connection = await mysql.createConnection({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    connectTimeout: 5000,
  });
  const [databaseRows] = await connection.query(
    "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
    [env.DB_NAME],
  );
  const databaseExists = databaseRows.length > 0;
  if (!databaseExists) {
    output({ status: "MISSING", message: `Database ${env.DB_NAME} does not exist.`, databaseExists: false, tableCount: 0 });
    process.exitCode = 3;
  } else {
    const [tableRows] = await connection.query(
      "SELECT COUNT(*) AS table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
      [env.DB_NAME],
    );
    const tableCount = Number(tableRows[0]?.table_count || 0);
    output({ status: "READY", message: `Connected to MySQL at ${env.DB_HOST}:${env.DB_PORT || 3306}.`, databaseExists: true, tableCount });
  }
} catch (error) {
  output({ status: "UNAVAILABLE", message: `MySQL connection failed (${error?.code || "connection error"}).`, databaseExists: false });
  process.exitCode = 4;
} finally {
  if (connection) await connection.end().catch(() => {});
}
