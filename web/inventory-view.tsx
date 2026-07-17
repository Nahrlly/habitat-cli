import React, { useCallback, useEffect, useState } from "react";
import { habitatApi, type InventoryItem } from "./api";
import "./inventory-view.css";

export function InventoryView() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await habitatApi.inventory();
      setItems(response.inventory.items);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load inventory.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return <section className="inventory-panel card">
    <div className="inventory-heading"><div><h2>Current inventory</h2><p className="muted">Read-only state from the Habitat REST API.</p></div><span className="status"><i className="dot green" /> {items.length} resource types</span></div>
    {error && <div className="error">{error}</div>}
    {items.length ? <div className="inventory-table"><table><thead><tr><th>Resource</th><th>Quantity</th><th>Unit</th><th>Category</th><th>Updated</th></tr></thead><tbody>{items.map((item) => <tr key={item.resourceId}><td><strong>{item.displayName ?? item.resourceId}</strong><small>{item.resourceId}</small></td><td className="inventory-quantity">{item.quantity}</td><td>{item.unit ?? "—"}</td><td>{item.category ?? "—"}</td><td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "—"}</td></tr>)}</tbody></table></div> : <p className="muted">No inventory items have been recorded.</p>}
  </section>;
}
