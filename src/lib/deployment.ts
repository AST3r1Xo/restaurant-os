// Build-time server configuration only. Never import this into a client module.
export function validateDeployment(env: NodeJS.ProcessEnv) {
  if (env.VERCEL !== "1") return;
  if (!["live", "demo"].includes(env.APP_DATA_MODE ?? ""))
    throw new Error("Vercel requires explicit APP_DATA_MODE=live or demo.");
  let app: URL;
  try {
    app = new URL(env.NEXT_PUBLIC_APP_URL ?? "");
  } catch {
    throw new Error(
      "Set NEXT_PUBLIC_APP_URL to the deployment's HTTPS origin.",
    );
  }
  if (
    app.protocol !== "https:" ||
    app.username ||
    app.password ||
    app.pathname !== "/" ||
    app.search ||
    app.hash ||
    app.hostname === "localhost" ||
    app.hostname.endsWith(".localhost") ||
    !app.hostname.includes(".") ||
    /^[\d.:\[\]]+$/.test(app.hostname)
  )
    throw new Error("NEXT_PUBLIC_APP_URL must be a public HTTPS origin.");
  if (env.APP_DATA_MODE === "demo") return;
  const ref = env.SUPABASE_EXPECTED_PROJECT_REF?.trim();
  if (!ref || !/^[a-z0-9]{20}$/.test(ref))
    throw new Error(
      "Set SUPABASE_EXPECTED_PROJECT_REF for this deployment environment.",
    );
  if (env.NEXT_PUBLIC_SUPABASE_URL?.trim() !== `https://${ref}.supabase.co`)
    throw new Error(
      "Supabase URL does not match this deployment's expected project.",
    );
  if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim())
    throw new Error("Live deployment requires the Supabase publishable key.");
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim())
    throw new Error("Live deployment requires the server-only media key.");
}

export function securityHeaders(https: boolean) {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "same-origin" },
    // These directives don't block Next.js hydration, model-viewer, or native AR.
    // This is deliberately not a claim of a complete script-src XSS policy.
    {
      key: "Content-Security-Policy",
      value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    },
    {
      key: "Permissions-Policy",
      value:
        "camera=(self), xr-spatial-tracking=(self), microphone=(), geolocation=(), payment=()",
    },
    ...(https
      ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
      : []),
  ];
}
