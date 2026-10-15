export function getSupabaseConfig() {
  // Explicit property access is necessary for Next.js browser env replacement.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url && !publishableKey) return null;
  if (!url || !publishableKey) {
    throw new Error(
      "Set both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
    );
  }
  if (publishableKey.startsWith("sb_secret_")) {
    throw new Error("Never use a privileged key in NEXT_PUBLIC_* variables.");
  }
  if (publishableKey.startsWith("eyJ")) {
    let role: string;
    try {
      const payload = publishableKey
        .split(".")[1]
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      role = JSON.parse(atob(payload)).role;
    } catch {
      throw new Error("The public Supabase key has an invalid JWT format.");
    }
    if (role !== "anon")
      throw new Error("Use a publishable or legacy anon key in NEXT_PUBLIC_*.");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP(S) URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTP(S).");
  return { url, publishableKey };
}

export function requireSupabaseConfig() {
  const config = getSupabaseConfig();
  if (!config)
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and set the public project credentials.",
    );
  return config;
}

export function getDataMode(): "demo" | "live" {
  const mode = process.env.APP_DATA_MODE?.trim() || "auto";
  if (!["auto", "demo", "live"].includes(mode))
    throw new Error("APP_DATA_MODE must be auto, demo, or live.");
  const config = getSupabaseConfig();
  if (mode === "demo") return "demo";
  if (mode === "live" && !config)
    throw new Error(
      "Live mode requires both Supabase public environment variables.",
    );
  return config ? "live" : "demo";
}
