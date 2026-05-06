export class NextTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class APIError extends NextTokenError {
  readonly status: number;
  readonly detail: string;
  readonly requestId?: string;

  constructor(status: number, detail: string, requestId?: string) {
    super(`HTTP ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
    if (requestId !== undefined) this.requestId = requestId;
  }
}

export class AuthError extends APIError {}
export class NotFoundError extends APIError {}
export class ConflictError extends APIError {}
export class RateLimitError extends APIError {}
export class InsufficientCreditsError extends APIError {}
export class PayloadTooLargeError extends APIError {}
export class BadRequestError extends APIError {}
export class ServerError extends APIError {}

export class RunCapExceededError extends APIError {
  readonly tier?: string;
  readonly cap?: number;
  readonly scope?: string;

  constructor(
    status: number,
    detail: string,
    payload: { tier?: string; cap?: number; scope?: string },
    requestId?: string,
  ) {
    super(status, detail, requestId);
    if (payload.tier !== undefined) this.tier = payload.tier;
    if (payload.cap !== undefined) this.cap = payload.cap;
    if (payload.scope !== undefined) this.scope = payload.scope;
  }
}

export class TimeoutError extends NextTokenError {}

export function errorFromResponse(
  status: number,
  body: unknown,
  requestId?: string,
): APIError {
  const detail = extractDetail(body);
  const capPayload = extractCapPayload(body);

  if (status === 400) return new BadRequestError(status, detail, requestId);
  if (status === 401) return new AuthError(status, detail, requestId);
  if (status === 402) {
    return new InsufficientCreditsError(status, detail, requestId);
  }
  if (status === 404) return new NotFoundError(status, detail, requestId);
  if (status === 409) return new ConflictError(status, detail, requestId);
  if (status === 413) {
    return new PayloadTooLargeError(status, detail, requestId);
  }
  if (status === 429) {
    if (capPayload) {
      return new RunCapExceededError(status, detail, capPayload, requestId);
    }
    return new RateLimitError(status, detail, requestId);
  }
  if (status >= 500) return new ServerError(status, detail, requestId);
  return new APIError(status, detail, requestId);
}

function extractDetail(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const detail = (body as Record<string, unknown>)["detail"];
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object") {
      const msg = (detail as Record<string, unknown>)["message"];
      if (typeof msg === "string") return msg;
      try {
        return JSON.stringify(detail);
      } catch {
        return String(detail);
      }
    }
  }
  return "Unknown error";
}

function extractCapPayload(
  body: unknown,
): { tier?: string; cap?: number; scope?: string } | undefined {
  if (!body || typeof body !== "object") return undefined;
  const detail = (body as Record<string, unknown>)["detail"];
  if (!detail || typeof detail !== "object") return undefined;
  const d = detail as Record<string, unknown>;
  if (d["error"] !== "active_run_cap_exceeded") return undefined;
  const payload: { tier?: string; cap?: number; scope?: string } = {};
  if (typeof d["tier"] === "string") payload.tier = d["tier"];
  if (typeof d["cap"] === "number") payload.cap = d["cap"];
  if (typeof d["scope"] === "string") payload.scope = d["scope"];
  return payload;
}
