import { withDatabase } from "./sqlite-state.js";

export type AutonomyConfig = { scheduleName: string; intervalMs: number; enabled: boolean; quietHours?: string };
export type AutonomyAudit = { timestamp: string; scheduleName: string; snapshotSummary: string; chosenAction: string; policyResult: string; actionResult: string; operatorNote: string };

export function loadAutonomyConfig(): AutonomyConfig {
  return withDatabase((db) => {
    db.run("CREATE TABLE IF NOT EXISTS autonomy_config (id INTEGER PRIMARY KEY CHECK (id = 1), config_json TEXT NOT NULL)");
    const row = db.query("SELECT config_json AS configJson FROM autonomy_config WHERE id = 1").get() as { configJson?: string } | null;
    return row?.configJson ? JSON.parse(row.configJson) as AutonomyConfig : { scheduleName: "default", intervalMs: 300000, enabled: false };
  });
}

export function saveAutonomyConfig(config: AutonomyConfig): void { withDatabase((db) => { db.run("CREATE TABLE IF NOT EXISTS autonomy_config (id INTEGER PRIMARY KEY CHECK (id = 1), config_json TEXT NOT NULL)"); db.query("INSERT OR REPLACE INTO autonomy_config (id, config_json) VALUES (1, ?)").run(JSON.stringify(config)); }); }

export function appendAutonomyAudit(audit: AutonomyAudit): void { withDatabase((db) => { db.run("CREATE TABLE IF NOT EXISTS autonomy_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, schedule_name TEXT NOT NULL, snapshot_summary TEXT NOT NULL, chosen_action TEXT NOT NULL, policy_result TEXT NOT NULL, action_result TEXT NOT NULL, operator_note TEXT NOT NULL)"); db.query("INSERT INTO autonomy_audit (timestamp, schedule_name, snapshot_summary, chosen_action, policy_result, action_result, operator_note) VALUES (?, ?, ?, ?, ?, ?, ?)").run(audit.timestamp, audit.scheduleName, audit.snapshotSummary, audit.chosenAction, audit.policyResult, audit.actionResult, audit.operatorNote); }); }

export function listAutonomyAudits(limit = 20): AutonomyAudit[] { return withDatabase((db) => { db.run("CREATE TABLE IF NOT EXISTS autonomy_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, schedule_name TEXT NOT NULL, snapshot_summary TEXT NOT NULL, chosen_action TEXT NOT NULL, policy_result TEXT NOT NULL, action_result TEXT NOT NULL, operator_note TEXT NOT NULL)"); return db.query("SELECT timestamp, schedule_name AS scheduleName, snapshot_summary AS snapshotSummary, chosen_action AS chosenAction, policy_result AS policyResult, action_result AS actionResult, operator_note AS operatorNote FROM autonomy_audit ORDER BY id DESC LIMIT ?").all(Math.max(1, Math.floor(limit))) as AutonomyAudit[]; }); }
