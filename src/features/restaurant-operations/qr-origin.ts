// Pure configuration validation shared by server exports and offline QR tests.
export function publicQROrigin(value: string | undefined): string {
  try {
    const u = new URL(value?.trim() ?? "");
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      !u.hostname.includes(".") ||
      u.hostname.endsWith(".") ||
      /^[\d.:[\]]+$/.test(u.hostname) ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)
    )
      throw new Error();
    return u.origin;
  } catch {
    throw new Error(
      "Printable QR codes need a stable public HTTPS address. Configure NEXT_PUBLIC_APP_URL, restart the app, and verify that address before printing. Localhost codes cannot be printed.",
    );
  }
}
export function tableQRUrl(origin: string, slug: string, token: string) {
  if (
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ||
    slug.length > 120 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      token,
    )
  )
    throw new Error("Invalid table QR configuration.");
  return `${publicQROrigin(origin)}/r/${slug}?table=${token}`;
}
