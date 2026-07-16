import { useEffect, useState } from "react";
import { habitatApi, type ResourceMissionReport, type ResourceMissionStatus } from "./api";
import { buildPinnedResourcePriorities, loadPinnedBlueprintIds } from "./pinned-blueprint-resources";

export function ResourceMissionPanel() {
  const [status, setStatus] = useState<ResourceMissionStatus | null>(null);
  const [report, setReport] = useState<ResourceMissionReport | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const active = status?.mission?.status === "running" || status?.mission?.status === "stopping";

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const next = await habitatApi.resourceMissionStatus();
        if (mounted) setStatus(next);
      } catch (requestError) {
        if (mounted) setError(requestError instanceof Error ? requestError.message : "Unable to load resource mission status.");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_500);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);

  async function start() {
    setPending(true);
    setError("");
    try {
      let priorityResources = [];
      try {
        const pinnedIds = loadPinnedBlueprintIds(window.localStorage);
        const [{ blueprints }, { inventory: { items } }] = await Promise.all([habitatApi.blueprints(), habitatApi.inventory()]);
        priorityResources = buildPinnedResourcePriorities(blueprints, pinnedIds, items);
      } catch {
        // Mission start remains available when optional blueprint data is unavailable.
      }
      setStatus(await habitatApi.startResourceMission(priorityResources));
      setReport(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to start resource mission.");
    } finally {
      setPending(false);
    }
  }

  async function stop() {
    setPending(true);
    setError("");
    try {
      setStatus(await habitatApi.stopResourceMission());
      const nextReport = await habitatApi.resourceMissionReport().catch(() => null);
      if (nextReport) setReport(nextReport.report);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to stop resource mission.");
    } finally {
      setPending(false);
    }
  }

  const eva = status?.eva;
  const carriedKg = eva?.carriedResources.reduce((total, resource) => total + resource.quantityKg, 0) ?? 0;
  return <section className="resource-mission-panel card" aria-live="polite">
    <div className="resource-mission-heading"><div><span className="eyebrow">AUTONOMY</span><h2>Resource mission</h2></div><span className={`status ${active ? "running" : ""}`}>{status?.mission?.status ?? "idle"}</span></div>
    <p>Server-owned scan and collection loop. It returns and docks at capacity or 25% battery or oxygen.</p>
    {eva && <div className="resource-mission-metrics"><span>Action <strong>{status?.mission?.currentAction ?? "idle"}</strong></span><span>Position <strong>({eva.x}, {eva.y})</strong></span><span>Battery <strong>{eva.suitBattery}/{eva.maxSuitBattery}</strong></span><span>Oxygen <strong>{eva.suitOxygen}/{eva.maxSuitOxygen}</strong></span><span>Load <strong>{carriedKg}/{eva.maxCarryingCapacityKg} kg</strong></span></div>}
    <div className="resource-mission-actions"><button disabled={pending || active} onClick={() => void start()}>{pending && !active ? "Starting..." : "Start resource mission"}</button><button className="ghost" disabled={pending || !active} onClick={() => void stop()}>{pending && active ? "Stopping..." : "Stop safely"}</button></div>
    {status?.mission?.stopReason && <small>Stop reason: {status.mission.stopReason}</small>}
    {report && <small>Latest report: {report.iterations.length} iterations, {report.collectedResources.reduce((total, resource) => total + resource.quantityKg, 0)} kg collected.</small>}
    {error && <small className="resource-mission-error">{error}</small>}
  </section>;
}
