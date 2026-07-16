import React, { useEffect, useMemo, useState } from "react";
import { habitatApi, type Blueprint, type InventoryItem } from "./api";

const PINNED_KEY = "habitat-pinned-blueprints";

export function blueprintLabel(blueprint: Blueprint): string {
  return blueprint.displayName.replace(/\s+Blueprint$/i, "").trim() || blueprint.blueprintId;
}

export function resourceLabel(resourceId: string): string {
  return resourceId.split(/[-_]/g).map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}

export function BlueprintView() {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "pinned">("all");
  const [pinned, setPinned] = useState<string[]>(() => loadPinned());
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([habitatApi.blueprints(), habitatApi.inventory()]).then(([catalog, stock]) => {
      if (!active) return;
      setBlueprints(catalog.blueprints);
      setInventory(stock.inventory.items ?? []);
      setSelectedId((current) => current || catalog.blueprints[0]?.blueprintId || "");
    }).catch((error) => {
      if (active) setMessage(error instanceof Error ? error.message : "Unable to load blueprint catalog.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return blueprints.filter((blueprint) => {
      const matchesFilter = filter === "all" || pinned.includes(blueprint.blueprintId);
      const matchesQuery = !normalized || `${blueprint.displayName} ${blueprint.blueprintId}`.toLowerCase().includes(normalized);
      return matchesFilter && matchesQuery;
    });
  }, [blueprints, filter, pinned, query]);
  const selected = blueprints.find((blueprint) => blueprint.blueprintId === selectedId) ?? visible[0] ?? null;
  const inventoryById = new Map(inventory.map((item) => [item.resourceId, item]));

  function togglePinned(id: string) {
    setPinned((current) => {
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
      window.localStorage.setItem(PINNED_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function startConstruction() {
    if (!selected) return;
    setBuilding(true);
    setMessage("");
    try {
      const result = await habitatApi.constructBlueprint(selected.blueprintId);
      const startedJob = result.startedJob as { pendingModuleName?: string } | undefined;
      setMessage(startedJob ? `Construction started for ${startedJob.pendingModuleName ?? blueprintLabel(selected)}.` : "Construction requirements are not satisfied.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start construction.");
    } finally {
      setBuilding(false);
    }
  }

  return <section className="blueprints-page">
    <header className="topbar blueprint-topbar"><div><span className="eyebrow">KEPLER CATALOG</span><h1>Blueprints</h1><p className="muted">Browse official designs, compare requirements with Habitat inventory, and pin the next build.</p></div><span className="catalog-count">{blueprints.length} official designs</span></header>
    {message && <div className="blueprint-notice" role="status">{message}</div>}
    <div className="blueprint-workspace">
      <aside className="blueprint-list card">
        <label className="blueprint-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or ID" /></label>
        <div className="blueprint-filters"><button className={filter === "all" ? "active" : "ghost"} onClick={() => setFilter("all")}>All <small>{blueprints.length}</small></button><button className={filter === "pinned" ? "active" : "ghost"} onClick={() => setFilter("pinned")}>Pinned <small>{pinned.length}</small></button></div>
        <div className="blueprint-results">{loading ? <p className="muted">Loading catalog...</p> : visible.length ? visible.map((blueprint) => <button className={`blueprint-list-item ${selected?.blueprintId === blueprint.blueprintId ? "selected" : ""}`} key={blueprint.blueprintId} onClick={() => setSelectedId(blueprint.blueprintId)}><span className="blueprint-thumb">{blueprintLabel(blueprint).slice(0, 2).toUpperCase()}</span><span><strong>{blueprintLabel(blueprint)}</strong><small>{blueprint.blueprintId} · Level {blueprint.level ?? 1}</small></span><span className="blueprint-arrow">›</span></button>) : <p className="muted">No blueprints match this view.</p>}</div>
      </aside>
      {selected ? <BlueprintDetail blueprint={selected} pinned={pinned.includes(selected.blueprintId)} onTogglePin={() => togglePinned(selected.blueprintId)} inventoryById={inventoryById} building={building} onBuild={() => void startConstruction()} /> : <section className="blueprint-empty card"><span className="eyebrow">NO SELECTION</span><h2>Select a blueprint</h2></section>}
    </div>
  </section>;
}

function BlueprintDetail({ blueprint, pinned, onTogglePin, inventoryById, building, onBuild }: { blueprint: Blueprint; pinned: boolean; onTogglePin: () => void; inventoryById: Map<string, InventoryItem>; building: boolean; onBuild: () => void }) {
  const inputs = Object.entries(blueprint.inputs ?? {}).filter(([, value]) => typeof value === "number");
  const output = blueprint.output ?? {};
  const facility = blueprint.requiredFacility ?? {};
  const runtime = blueprint.runtimeAttributes ?? {};
  return <section className="blueprint-detail card">
    <div className="blueprint-detail-head"><div><span className="blueprint-status">PUBLISHED</span><h2>{blueprint.displayName}</h2><code>{blueprint.blueprintId}</code></div><div className="blueprint-detail-actions"><button className={pinned ? "pin-button pinned" : "pin-button ghost"} onClick={onTogglePin} aria-pressed={pinned}>{pinned ? "* Pinned" : "Pin blueprint"}</button><button disabled={building} onClick={onBuild}>{building ? "Starting..." : "Start construction"}</button></div></div>
    <p className="blueprint-description">{blueprint.description || "No description supplied by Kepler."}</p>
    <div className="blueprint-detail-grid"><div className="blueprint-art"><span>{blueprintLabel(blueprint).slice(0, 2).toUpperCase()}</span><small>KEPLER DESIGN</small></div><div className="blueprint-facts"><FactGroup title="Requirements" rows={[["Module type", String(output.moduleType ?? "Not specified")], ["Minimum level", String(facility.minimumLevel ?? blueprint.level ?? 1)], ["Prerequisites", blueprint.prerequisites?.length ? blueprint.prerequisites.join(", ") : "None"], ["Attachments", blueprint.attachmentRequirements?.length ? String(blueprint.attachmentRequirements.length) : "None"]]} /><FactGroup title="Output & unlocks" rows={[["Item type", String(output.itemType ?? "module")], ["Quantity", String(output.quantity ?? 1)], ["Build time", `${blueprint.buildTicks ?? 0} ticks`], ["Unlocks", blueprint.unlocks?.length ? blueprint.unlocks.join(", ") : "None"]]} /><FactGroup title="Runtime attributes" rows={Object.entries(runtime).filter(([, value]) => typeof value !== "object").slice(0, 6).map(([key, value]) => [key, String(value)])} /></div></div>
    <div className="required-resources"><div className="section-heading"><div><span className="eyebrow">REQUIRED RESOURCES</span><h3>Build inputs</h3></div><small>{inputs.filter(([id, amount]) => Number(inventoryById.get(id)?.quantity ?? 0) >= Number(amount)).length} of {inputs.length} ready</small></div>{inputs.length ? <div className="resource-cards">{inputs.map(([resourceId, amount]) => { const needed = Number(amount); const have = Number(inventoryById.get(resourceId)?.quantity ?? 0); const ready = have >= needed; return <div className={`resource-card ${ready ? "ready" : "short"}`} key={resourceId}><div className="resource-visual">{resourceLabel(resourceId).slice(0, 1)}</div><strong>{resourceLabel(resourceId)}</strong><div className="resource-amounts"><span>Need <b>{needed} kg</b></span><span>Have <b>{have} kg</b></span></div><div className="resource-bar"><i style={{ width: `${Math.min(100, needed ? have / needed * 100 : 100)}%` }} /></div><small>{ready ? "READY" : `${Math.max(0, needed - have)} kg short`}</small></div>; })}</div> : <p className="muted">This blueprint has no inventory inputs.</p>}</div>
  </section>;
}

function FactGroup({ title, rows }: { title: string; rows: string[][] }) { return <div className="fact-group"><h3>{title}</h3>{rows.length ? rows.map(([label, value]) => <div className="fact-row" key={label}><span>{label}</span><strong>{value}</strong></div>) : <p className="muted">None reported.</p>}</div>; }

function loadPinned(): string[] { try { const value = JSON.parse(window.localStorage.getItem(PINNED_KEY) ?? "[]"); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }
