import { withDatabase } from "./sqlite-state.js";

export type PowerHistoryPoint = { recordedAt: string; generationKw: number; consumptionKw: number; netKw: number; modules: Array<{ selector: string; displayName: string; powerKw: number }> };

export function recordPowerHistory(point: PowerHistoryPoint): void {
  withDatabase((db) => db.query("INSERT INTO power_history (recorded_at, generation_kw, consumption_kw, net_kw, modules_json) VALUES (?, ?, ?, ?, ?)").run(point.recordedAt, point.generationKw, point.consumptionKw, point.netKw, JSON.stringify(point.modules)));
}

export function loadPowerHistory(limit = 120): PowerHistoryPoint[] {
  return withDatabase((db) => db.query("SELECT recorded_at AS recordedAt, generation_kw AS generationKw, consumption_kw AS consumptionKw, net_kw AS netKw, modules_json AS modulesJson FROM power_history ORDER BY recorded_at DESC LIMIT ?").all(limit).reverse()).map((row) => ({ recordedAt: String((row as any).recordedAt), generationKw: Number((row as any).generationKw), consumptionKw: Number((row as any).consumptionKw), netKw: Number((row as any).netKw), modules: JSON.parse(String((row as any).modulesJson)) }));
}

export function clearPowerHistory(): void {
  withDatabase((db) => db.run("DELETE FROM power_history;"));
}
