export function getApiBaseUrl(): string | null {
  const rawBaseUrl = process.env.HABITAT_API_BASE_URL?.trim();

  if (!rawBaseUrl) {
    return null;
  }

  return rawBaseUrl.replace(/\/+$/, "");
}

export async function fetchApiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getApiBaseUrl();

  if (!baseUrl) {
    throw new Error("Missing HABITAT_API_BASE_URL.");
  }

  const response = await fetch(`${baseUrl}${normalizePath(path)}`, init);

  if (!response.ok) {
    const errorText = await readErrorText(response);
    throw new Error(errorText ?? `Request failed with ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function postApiJson<T>(path: string, body: unknown): Promise<T> {
  return fetchApiJson<T>(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function fetchApiJsonOrNull<T>(path: string, init?: RequestInit): Promise<T | null> {
  const baseUrl = getApiBaseUrl();

  if (!baseUrl) {
    throw new Error("Missing HABITAT_API_BASE_URL.");
  }

  const response = await fetch(`${baseUrl}${normalizePath(path)}`, init);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorText = await readErrorText(response);
    throw new Error(errorText ?? `Request failed with ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

async function readErrorText(response: Response): Promise<string | null> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    return text.trim() || null;
  }

  try {
    const payload = (await response.json()) as { error?: string; message?: string };
    return payload.error ?? payload.message ?? null;
  } catch {
    return null;
  }
}
