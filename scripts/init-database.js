import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, "server", ".env");
const schemaPath = path.join(projectRoot, "database", "schema.sql");

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

function isPlaceholder(value) {
  return !value || /^(your_|change_me|replace_me|example_|password_here|username_here)/i.test(value) || /your_mysql|your_password|replace_me/i.test(value);
}

const env = readEnv(envPath);
const required = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"];
const missing = required.filter((key) => isPlaceholder(env[key]));
if (!fs.existsSync(envPath)) {
  console.error("[DB] server/.env is missing. Run setup-all.ps1 first.");
  process.exit(2);
}
if (missing.length > 0) {
  console.error(`[DB] Database configuration is incomplete (${missing.join(", ")}).`);
  process.exit(2);
}
if (env.DB_NAME !== "ai_english_friend") {
  console.error("[DB] schema.sql targets the ai_english_friend database. Set DB_NAME=ai_english_friend before using -InitDatabase.");
  process.exit(2);
}
if (!fs.existsSync(schemaPath)) {
  console.error("[DB] database/schema.sql is missing.");
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
    multipleStatements: true,
  });
  const [tableRows] = await connection.query(
    "SELECT COUNT(*) AS table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
    [env.DB_NAME],
  );
  const tableCount = Number(tableRows[0]?.table_count || 0);
  if (tableCount > 0) {
    console.error("Database already contains tables.");
    console.error("Initialization was cancelled to protect existing data.");
    process.exitCode = 5;
  } else {
    const schemaSql = fs.readFileSync(schemaPath, "utf8");
    await connection.query(schemaSql);
    console.log("Fresh database schema initialized from database/schema.sql.");
    console.log("No seed rows or personal data were imported.");
  }
} catch (error) {
  console.error(`[DB] Fresh initialization failed (${error?.code || "database error"}).`);
  process.exitCode = 6;
} finally {
  if (connection) await connection.end().catch(() => {});
}
