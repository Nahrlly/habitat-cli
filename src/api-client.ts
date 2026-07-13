type JsonValue = unknown;

export type ApiClientOptions = {
  baseUrl?: string;
};

export type ApiErrorDetails = {
  status: number;
  statusText: string;
  message: string;
  body?: JsonValue;
};

export class ApiError extends Error {
  status: number;
  statusText: string;
  body?: JsonValue;

  constructor(details: ApiErrorDetails) {
    super(details.message);
    this.name = "ApiError";
    this.status = details.status;
    this.statusText = details.statusText;
    this.body = details.body;
  }
}

export function getApiBaseUrl(): string {
  return process.env.HABITAT_API_BASE_URL?.trim() || "http://localhost:8787";
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? getApiBaseUrl());

  return {
    get baseUrl() {
      return baseUrl;
    },
    async getJson<T>(path: string): Promise<T> {
      return requestJson<T>(baseUrl, path, {
        method: "GET",
      });
    },
    async postJson<T>(path: string, body?: JsonValue): Promise<T> {
      return requestJson<T>(baseUrl, path, {
        method: "POST",
        body,
      });
    },
    async patchJson<T>(path: string, body?: JsonValue): Promise<T> {
      return requestJson<T>(baseUrl, path, {
        method: "PATCH",
        body,
      });
    },
    async deleteJson<T>(path: string): Promise<T> {
      return requestJson<T>(baseUrl, path, {
        method: "DELETE",
      });
    },
  };
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    body?: JsonValue;
  },
): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    method: init.method,
    headers: {
      Accept: "application/json",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (!response.ok) {
    throw await createFriendlyApiError(response);
  }

  return (await response.json()) as T;
}

async function createFriendlyApiError(response: Response): Promise<ApiError> {
  const fallbackMessage = `${response.status} ${response.statusText}`;

  try {
    const body = (await response.json()) as JsonValue;
    const message = extractErrorMessage(body) ?? fallbackMessage;

    return new ApiError({
      status: response.status,
      statusText: response.statusText,
      message,
      body,
    });
  } catch {
    return new ApiError({
      status: response.status,
      statusText: response.statusText,
      message: fallbackMessage,
    });
  }
}

function extractErrorMessage(body: JsonValue): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const record = body as Record<string, unknown>;
  const message = record.error ?? record.message;

  return typeof message === "string" && message.trim() ? message.trim() : null;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();

  if (!trimmed) {
    return "http://localhost:8787";
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}
