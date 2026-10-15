// A distinct storage namespace keeps guest identity independent of staff Auth.
// No browser client uses these cookies; only SSR code can access the session.
export function guestCookieOptions(url: string) {
  return {
    name: `restaurant-os-guest-${new URL(url).hostname.replace(/[^a-zA-Z0-9-]/g, "-")}`,
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 30,
  };
}

export function isGuestCookie(name: string, url: string) {
  const base = guestCookieOptions(url).name;
  return name === base || name.startsWith(`${base}.`);
}
