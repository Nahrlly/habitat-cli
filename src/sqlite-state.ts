import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDataDirectory = path.resolve(__dirname, "../data");
const databaseFileName = "habitat.sqlite";

export function getDataDirectory(): string {
  return process.env.HABITAT_DATA_DIRECTORY
    ? path.resolve(process.env.HABITAT_DATA_DIRECTORY)
    : defaultDataDirectory;
}

export function getDatabaseFilePath(): string {
  return path.join(getDataDirectory(), databaseFileName);
}

export function withDatabase<T>(callback: (db: Database) => T): T {
  ensureDataDirectory();
  const db = openDatabase();

  try {
    return callback(db);
  } finally {
    db.close();
  }
}

export function clearSQLiteState(): void {
  ensureDataDirectory();
  writeFileSync(getDatabaseFilePath(), "", "utf8");
}

export function ensureDataDirectory(): void {
  mkdirSync(getDataDirectory(), { recursive: true });
}

function openDatabase(): Database {
  const dbPath = getDatabaseFilePath();
  const db = new Database(dbPath);
  db.run("PRAGMA busy_timeout = 5000;");
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");
  initializeSchema(db);

  return db;
}

function initializeSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS kepler_registration (
      habitat_id TEXT PRIMARY KEY,
      habitat_uuid TEXT NOT NULL,
      display_name TEXT NOT NULL,
      stream_url TEXT NOT NULL,
      api_token TEXT NOT NULL,
      stream_json TEXT NOT NULL,
      contracts_json TEXT NOT NULL,
      habitat_json TEXT NOT NULL,
      blueprints_json TEXT NOT NULL
    );
  `);
  ensureColumn(db, "kepler_registration", "stream_url", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "kepler_registration", "api_token", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "kepler_registration", "stream_json", "TEXT NOT NULL DEFAULT '{}' ");
  ensureColumn(db, "kepler_registration", "contracts_json", "TEXT NOT NULL DEFAULT '{}' ");
  db.run(`
    CREATE TABLE IF NOT EXISTS habitat_humans (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      location_module_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS habitat_alerts (
      id TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      details_json TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS habitat_modules (
      id TEXT PRIMARY KEY,
      selector TEXT NOT NULL,
      blueprint_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      connected_to_json TEXT NOT NULL,
      runtime_attributes_json TEXT NOT NULL,
      capabilities_json TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      resource_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS construction_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active_job_json TEXT NOT NULL
    );
  `);
  db.run(`CREATE TABLE IF NOT EXISTS eva_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    deployed_human_id TEXT,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    carried_resources_json TEXT NOT NULL,
    max_carrying_capacity_kg REAL NOT NULL
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS power_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT NOT NULL,
    generation_kw REAL NOT NULL,
    consumption_kw REAL NOT NULL,
    net_kw REAL NOT NULL,
    modules_json TEXT NOT NULL
  );`);
}

function ensureColumn(db: Database, tableName: string, columnName: string, definition: string): void {
  const columns = db
    .query(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
}
