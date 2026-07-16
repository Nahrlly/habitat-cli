import React, { useEffect, useState } from "react";
import type { ResourceScan } from "./api";
import { getScanTiles } from "./scan-model";

type ScanEvent = { result: ResourceScan; strength: number; radius: number };

export function ScanPopup() {
  const [scan, setScan] = useState<ScanEvent | null>(null);
  useEffect(() => { const onScan = (event: Event) => setScan((event as CustomEvent<ScanEvent>).detail); window.addEventListener("habitat-scan-result", onScan); return () => window.removeEventListener("habitat-scan-result", onScan); }, []);
  if (!scan) return null;
  const tiles = getScanTiles(scan.result);
  return <div className="scan-popup" role="dialog" aria-label="Current scan results"><div className="scan-popup-header"><div><span className="eyebrow">EVA SENSOR REPORT</span><h2>Current scan results</h2><small>Strength {scan.strength} · Radius {scan.radius} tiles</small></div><button className="ghost" onClick={() => setScan(null)} aria-label="Close scan results">×</button></div><div className="scan-popup-body">{tiles.length ? <table><thead><tr><th>Coordinate</th><th>Resource</th><th>Probability</th><th>Estimate</th></tr></thead><tbody>{tiles.map((tile, index) => { const resource = tile.topCandidate?.resourceType ?? "No identified resource"; const estimate = tile.quantityEstimate; return <tr key={`${tile.x}-${tile.y}-${index}`}><td>({tile.x}, {tile.y})</td><td>{resource}</td><td>{tile.topCandidate?.probabilityPct ?? 0}%</td><td>{estimate?.estimatedKg === undefined ? "—" : `${estimate.estimatedKg} kg`}</td></tr>; })}</tbody></table> : <p className="muted">The scan returned no tiles.</p>}</div></div>;
}
