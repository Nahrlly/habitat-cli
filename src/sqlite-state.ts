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
    CREATE TABLE IF NOT EXISTS clock_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL DEFAULT 'manual',
      listening INTEGER NOT NULL DEFAULT 0,
      connection_status TEXT NOT NULL DEFAULT 'disconnected',
      latest_absolute_tick INTEGER,
      latest_advanced_by INTEGER,
      last_connection_at TEXT,
      last_message_at TEXT,
      latest_error TEXT
    );
  `);
  ensureColumn(db, "clock_state", "mode", "TEXT NOT NULL DEFAULT 'manual'");
  ensureColumn(db, "clock_state", "listening", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "clock_state", "connection_status", "TEXT NOT NULL DEFAULT 'disconnected'");
  ensureColumn(db, "clock_state", "latest_absolute_tick", "INTEGER");
  ensureColumn(db, "clock_state", "latest_advanced_by", "INTEGER");
  ensureColumn(db, "clock_state", "last_connection_at", "TEXT");
  ensureColumn(db, "clock_state", "last_message_at", "TEXT");
  ensureColumn(db, "clock_state", "latest_error", "TEXT");
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
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      subject_json TEXT,
      details_json TEXT NOT NULL
    );
  `);
  ensureColumn(db, "habitat_alerts", "occurrence_count", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "habitat_alerts", "subject_json", "TEXT");
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
    max_carrying_capacity_kg REAL NOT NULL,
    suit_battery REAL NOT NULL DEFAULT 100,
    max_suit_battery REAL NOT NULL DEFAULT 100,
    suit_oxygen REAL NOT NULL DEFAULT 100,
    max_suit_oxygen REAL NOT NULL DEFAULT 100
  );`);
  ensureColumn(db, "eva_state", "suit_battery", "REAL NOT NULL DEFAULT 100");
  ensureColumn(db, "eva_state", "max_suit_battery", "REAL NOT NULL DEFAULT 100");
  ensureColumn(db, "eva_state", "suit_oxygen", "REAL NOT NULL DEFAULT 100");
  ensureColumn(db, "eva_state", "max_suit_oxygen", "REAL NOT NULL DEFAULT 100");
  db.run(`CREATE TABLE IF NOT EXISTS power_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT NOT NULL,
    generation_kw REAL NOT NULL,
    consumption_kw REAL NOT NULL,
    net_kw REAL NOT NULL,
    modules_json TEXT NOT NULL
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS resource_missions (
    id TEXT PRIMARY KEY,
    human_id TEXT NOT NULL,
    status TEXT NOT NULL,
    active_key TEXT UNIQUE,
    current_action TEXT,
    stop_reason TEXT,
    error TEXT,
    final_eva_json TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS resource_mission_iterations (
    id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL REFERENCES resource_missions(id),
    sequence INTEGER NOT NULL,
    action TEXT NOT NULL,
    action_input_json TEXT NOT NULL,
    scan_json TEXT,
    collected_resources_json TEXT NOT NULL,
    error TEXT,
    eva_snapshot_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (mission_id, sequence)
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
