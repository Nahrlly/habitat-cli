import { describe, expect, test } from "bun:test";
import { remoteModeEnabled } from "./commands.js";

describe("CLI remote mode", () => {
  test("defaults to remote mode when an API base URL is configured", () => {
    expect(remoteModeEnabled({ HABITAT_API_BASE_URL: "http://127.0.0.1:8787" })).toBe(true);
  });
});
