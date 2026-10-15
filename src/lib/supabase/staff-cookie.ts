export function staffCookieOptions(url: string) {
  return {
    name: `restaurant-os-staff-${new URL(url).hostname.replace(/[^a-zA-Z0-9-]/g, "-")}`,
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 30,
  };
}
export function isStaffCookie(name: string, url: string) {
  const base = staffCookieOptions(url).name;
  return name === base || name.startsWith(`${base}.`);
}
