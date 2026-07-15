import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createProgram } from "./commands.js";

describe("solar commands", () => {
  const originalCwd = process.cwd();
  const originalBaseUrl = process.env.KEPLER_BASE_URL;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.KEPLER_BASE_URL = "https://planet.turingguild.com";
  });

  afterEach(() => {
    process.exitCode = 0;

    if (originalBaseUrl === undefined) {
      delete process.env.KEPLER_BASE_URL;
    } else {
      process.env.KEPLER_BASE_URL = originalBaseUrl;
    }

    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
  });

  test("status renders Kepler solar irradiance data", async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const fetchCalls: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      return new Response(
        JSON.stringify({
          solarIrradiance: {
            irradianceKwPerSquareMeter: 1.25,
            measuredAt: "2026-07-09T12:34:56Z",
            source: "planet-sensor",
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    console.log = (...args: unknown[]) => {
      output.push(args.join(" "));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };

    try {
      await createProgram().parseAsync(["solar", "status"], { from: "user" });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    expect(errors).toHaveLength(0);
    expect(fetchCalls[0]).toMatch(/\/solar\/status$/);
    expect(output.join("\n")).toContain("Solar irradiance:");
    expect(output.join("\n")).toContain("irradianceKwPerSquareMeter");
    expect(output.join("\n")).toContain("1.25");
    expect(output.join("\n")).toContain("planet-sensor");
  });
});
