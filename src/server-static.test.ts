import { describe, expect, test } from "bun:test";
import { app } from "./server.js";

describe("production dashboard serving", () => {
  test("serves the SPA entry for a client-side route", async () => {
    const response = await app.fetch(new Request("http://localhost/dashboard"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("<div id=\"root\">");
  });

  test("serves the SPA entry for the blueprints route", async () => {
    const response = await app.fetch(new Request("http://localhost/blueprints"));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<div id=\"root\">");
  });

  test("returns 404 for a missing asset instead of the SPA", async () => {
    const response = await app.fetch(new Request("http://localhost/assets/missing.js"));

    expect(response.status).toBe(404);
  });

  test("serves dashboard resource artwork with an image content type", async () => {
    const response = await app.fetch(new Request("http://localhost/resources/basalt-composite.png"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });
});
