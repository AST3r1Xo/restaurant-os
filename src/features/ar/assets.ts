export type ModelDimensions = readonly [number, number, number];
export type ProductVisualization = {
  src: string;
  arEnabled?: boolean;
  iosSrc?: string;
  poster?: string;
  alt: string;
  dimensions?: ModelDimensions;
  demonstration?: boolean;
  development?: { label: string; attribution: string; source: string };
};

// The SDK caches rejected loads by URL as well as successful models. A retry
// needs a fresh fetch/cache key, without private cache APIs or any credentials.
// Configured URLs remain query-free; this one non-sensitive parameter is ours.
export function previewSource(src: string, attempt: number) {
  return Number.isSafeInteger(attempt) && attempt > 0
    ? `${src}?preview_attempt=${attempt}`
    : src;
}

export function modelDimensions(value: unknown): ModelDimensions | undefined {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (n) =>
        typeof n === "number" && Number.isFinite(n) && n >= 0.003 && n <= 1.2,
    )
    ? [value[0], value[1], value[2]]
    : undefined;
}

// Models are public catalogue assets, never signed URLs, arbitrary third-party
// hosts, QR context, Auth, or other restaurants' storage paths.
export function safeModelAsset(
  value: unknown,
  format: "glb" | "usdz" | "poster",
  restaurantId: string,
  productId: string,
  supabaseUrl?: string,
): string | undefined {
  if (typeof value !== "string" || value.length > 2048 || !value.length) return;
  if (![restaurantId, productId].every((s) => /^[a-zA-Z0-9_-]{1,160}$/.test(s)))
    return;
  if (/[\\%?#\s]/.test(value) || value.includes("..")) return;
  const extension = format === "poster" ? "(?:webp|jpg|jpeg|png|avif)" : format;
  const file = `[a-zA-Z0-9_-]+\\.${extension}`;
  if (new RegExp(`^/models/${restaurantId}/${productId}/${file}$`).test(value))
    return value;
  try {
    const url = new URL(value),
      base = new URL(supabaseUrl ?? "");
    if (
      (url.origin === base.origin &&
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        new RegExp(
          `^/storage/v1/object/public/dish-models/${restaurantId}/${productId}/${file}$`,
        ).test(url.pathname)) ||
      (url.origin === base.origin &&
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        new RegExp(
          `^/storage/v1/object/public/restaurant-media/restaurants/${restaurantId}/products/${productId}/${format === "poster" ? "images" : "models"}/${file}$`,
        ).test(url.pathname))
    )
      return url.href;
  } catch {
    /* Missing/unsafe assets leave ordinary photography available. */
  }
}

export function productVisualization(
  row: {
    id: string;
    name: string;
    model_glb_url?: string | null;
    model_verified?: boolean;
    model_demo_enabled?: boolean;
    model_ar_enabled?: boolean;
    model_usdz_url?: string | null;
    model_poster_url?: string | null;
    model_dimensions_m?: number[] | null;
  },
  restaurantId: string,
  supabaseUrl: string,
): ProductVisualization | undefined {
  const demonstration = row.model_demo_enabled === true;
  if (row.model_verified !== true && !demonstration) return;
  const src = safeModelAsset(
    row.model_glb_url,
    "glb",
    restaurantId,
    row.id,
    supabaseUrl,
  );
  if (!src) return;
  return {
    src,
    demonstration,
    arEnabled: !demonstration && row.model_ar_enabled === true,
    iosSrc: demonstration
      ? undefined
      : safeModelAsset(
          row.model_usdz_url,
          "usdz",
          restaurantId,
          row.id,
          supabaseUrl,
        ),
    poster: safeModelAsset(
      row.model_poster_url,
      "poster",
      restaurantId,
      row.id,
      supabaseUrl,
    ),
    alt: demonstration
      ? `3D demonstration of ${row.name}. Sample model, not a verified restaurant dish or real portion size.`
      : `Interactive 3D presentation of ${row.name}. Customizations are shown in your selection, not on this model.`,
    dimensions: modelDimensions(row.model_dimensions_m),
  };
}

export function dimensionsMatch(
  expected: ModelDimensions | undefined,
  measured: { x: number; y: number; z: number },
) {
  const actual = modelDimensions([measured.x, measured.y, measured.z]);
  return (
    !!expected &&
    !!actual &&
    actual.every(
      (n, i) =>
        Math.abs(n - expected[i]) <= Math.max(0.002, expected[i] * 0.05),
    )
  );
}

export function arAvailability(
  https: boolean,
  capable: boolean,
  scaleMatches: boolean,
  enabled = true,
) {
  if (!enabled) return "disabled" as const;
  if (!https) return "https" as const;
  if (!scaleMatches) return "scale" as const;
  return capable ? ("available" as const) : ("unsupported" as const);
}
