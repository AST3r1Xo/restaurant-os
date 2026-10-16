export const DEMO_RESTAURANT_SLUG = "mesa";
export const DEMO_TABLE_TOKEN = "22222222-2222-4222-8222-222222222222";
export const DEMO_TABLES = Array.from({ length: 5 }, (_, i) => ({
  label: `Table ${String(i + 1).padStart(2, "0")}`,
  token:
    i === 3 ? DEMO_TABLE_TOKEN : `1000000${i + 1}-0000-4000-8000-000000000001`,
}));
export const DEMO_MENU_URL =
  `/r/${DEMO_RESTAURANT_SLUG}?table=${DEMO_TABLE_TOKEN}` as const;

export function normalizeTableToken(
  value: string | string[] | undefined,
): string | null {
  if (value === undefined) return null;
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    return "invalid";
  return value.toLowerCase();
}

export function customerPath(
  slug: string,
  page: "menu" | "cart" | "orders" | "review" | "bill",
  tableToken?: string,
) {
  const base = `/r/${encodeURIComponent(slug)}${page === "menu" ? "" : `/${page}`}`;
  return tableToken ? `${base}?table=${encodeURIComponent(tableToken)}` : base;
}

export function orderPath(slug: string, orderId: string, tableToken?: string) {
  const base = `${customerPath(slug, "orders")}/${encodeURIComponent(orderId)}`;
  return tableToken ? `${base}?table=${encodeURIComponent(tableToken)}` : base;
}

export function productPath(
  slug: string,
  productId: string,
  tableToken?: string,
) {
  const base = `${customerPath(slug, "menu")}/products/${encodeURIComponent(productId)}`;
  return tableToken ? `${base}?table=${encodeURIComponent(tableToken)}` : base;
}
