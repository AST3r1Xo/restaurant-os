import { InvalidOrderPayload, MAX_ORDER_BYTES } from "./payload.ts";

// Next.js also performs its Origin/Host CSRF check and body-size enforcement.
// Require an explicit same-origin browser POST instead of accepting an absent
// Origin. Do not widen allowedOrigins for public order actions.
export function validateOrderOrigin(
  origin: string | null,
  host: string | null,
  contentLength?: string | null,
) {
  if (!origin || !host || origin.length > 2048 || host.length > 255)
    throw new InvalidOrderPayload();
  try {
    const parsed = new URL(origin);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.host !== host.split(",")[0].trim() ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      throw new InvalidOrderPayload();
  } catch {
    throw new InvalidOrderPayload();
  }
  if (
    contentLength !== undefined &&
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_ORDER_BYTES)
  )
    throw new InvalidOrderPayload();
}
