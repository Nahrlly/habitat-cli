import React, { useEffect, useMemo, useState } from "react";
import type { ResourceScan } from "./api";
import { buildScanPlot, getScanTiles, mergeScanResults } from "./scan-model";

type ScanEvent = { result: ResourceScan; strength: number; radius: number };

const resourcePalette = ["#6ea8ff", "#bb86fc", "#42d3b2", "#ffb45c", "#ef7e9d", "#a9d46f"];

function colorForResource(resource: string, resources: string[]): string {
  return resourcePalette[Math.max(0, resources.indexOf(resource)) % resourcePalette.length] ?? resourcePalette[0];
}

function formatEstimate(tile: ReturnType<typeof getScanTiles>[number]): string {
  return tile.quantityEstimate?.estimatedKg === undefined ? "—" : `${tile.quantityEstimate.estimatedKg} kg`;
}

export function ScanPopup() {
  const [scan, setScan] = useState<ScanEvent | null>(null);
  const [scanHistory, setScanHistory] = useState<ResourceScan | null>(null);
  useEffect(() => {
    const onScan = (event: Event) => {
      const detail = (event as CustomEvent<ScanEvent>).detail;
      setScan(detail);
      setScanHistory((previous) => mergeScanResults(previous, detail.result));
    };
    window.addEventListener("habitat-scan-result", onScan);
    return () => window.removeEventListener("habitat-scan-result", onScan);
  }, []);

  const plot = useMemo(() => (scanHistory ? buildScanPlot(scanHistory) : null), [scanHistory]);
  if (!scan || !plot) return null;

  const resources = [...new Set(plot.tiles.map((tile) => tile.resourceLabel))];
  const xs = [plot.origin.x, ...plot.tiles.map((tile) => tile.x)];
  const ys = [plot.origin.y, ...plot.tiles.map((tile) => tile.y)];
  const minX = Math.min(...xs) - 1;
  const maxX = Math.max(...xs) + 1;
  const minY = Math.min(...ys) - 1;
  const maxY = Math.max(...ys) + 1;
  const width = maxX - minX;
  const height = maxY - minY;
  const viewBox = `${minX} ${-maxY} ${width} ${height}`;

  return <div className="scan-popup" role="dialog" aria-label="Current scan results">
    <div className="scan-popup-header">
      <div><span className="eyebrow">EVA SENSOR REPORT</span><h2>Current scan results</h2><small>Strength {scan.strength} · Radius {scan.radius} tiles</small></div>
      <button className="ghost" onClick={() => setScan(null)} aria-label="Close scan results">×</button>
    </div>
    <div className="scan-popup-body">
      {plot.tiles.length ? <>
        <div className="scan-map-heading"><strong>Possible resources by tile</strong><span>Origin ({plot.origin.x}, {plot.origin.y})</span></div>
        <svg className="scan-map" viewBox={viewBox} role="img" aria-label="Resource possibilities plotted by scanned coordinate">
          <title>Scanned resource plot</title>
          <desc>Each marker shows the highest-probability resource returned for one scanned tile.</desc>
          {Array.from({ length: width + 1 }, (_, index) => { const x = minX + index; return <line key={`x-${x}`} className="scan-map-grid" x1={x} y1={-maxY} x2={x} y2={-minY} />; })}
          {Array.from({ length: height + 1 }, (_, index) => { const y = minY + index; return <line key={`y-${y}`} className="scan-map-grid" x1={minX} y1={-y} x2={maxX} y2={-y} />; })}
          <circle className="scan-map-origin" cx={plot.origin.x} cy={-plot.origin.y} r={0.22} />
          <text className="scan-map-origin-label" x={plot.origin.x + 0.28} y={-plot.origin.y - 0.3}>Origin</text>
          {plot.tiles.map((tile, index) => <g key={`${tile.x}-${tile.y}-${index}`} className="scan-map-tile">
            <title>({tile.x}, {tile.y}): {tile.resourceLabel}, {tile.probabilityPct}% probability, {formatEstimate(tile)}</title>
            <circle cx={tile.x} cy={-tile.y} r={0.28} fill={colorForResource(tile.resourceLabel, resources)} />
            <text x={tile.x} y={-tile.y + 0.08} textAnchor="middle">{tile.resourceLabel.slice(0, 3).toUpperCase()}</text>
            <text className="scan-map-coordinate" x={tile.x} y={-tile.y + 0.55} textAnchor="middle">{tile.x},{tile.y}</text>
          </g>)}
        </svg>
        <div className="scan-map-legend" aria-label="Resource legend">{resources.map((resource) => <span key={resource}><i style={{ background: colorForResource(resource, resources) }} />{resource}</span>)}</div>
        <table><thead><tr><th>Coordinate</th><th>Resource</th><th>Probability</th><th>Estimate</th></tr></thead><tbody>{plot.tiles.map((tile, index) => <tr key={`${tile.x}-${tile.y}-${index}`}><td>({tile.x}, {tile.y})</td><td>{tile.resourceLabel}</td><td>{tile.probabilityPct}%</td><td>{formatEstimate(tile)}</td></tr>)}</tbody></table>
      </> : <p className="muted">The scan returned no tiles.</p>}
    </div>
  </div>;
}
