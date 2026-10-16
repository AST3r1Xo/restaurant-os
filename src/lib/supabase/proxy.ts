import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getDataMode, getSupabaseConfig } from "@/lib/env";
import type { Database } from "@/types/database";
import { guestCookieOptions, isGuestCookie } from "./guest-cookie";
import { staffCookieOptions, isStaffCookie } from "./staff-cookie";
import { refreshForRouting } from "./refresh";

export async function updateSession(request: NextRequest) {
  // Explicit demo must remain independent of Auth, even with local live keys.
  if (getDataMode() === "demo") return NextResponse.next({ request });
  const config = getSupabaseConfig();
  let response = NextResponse.next({ request });
  if (!config) return response;

  const supabase = createServerClient<Database>(
    config.url,
    config.publishableKey,
    {
      cookieOptions: staffCookieOptions(config.url),
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            cache: "no-store",
            signal: AbortSignal.timeout(10000),
          }),
      },
      cookies: {
        getAll: () =>
          request.cookies
            .getAll()
            .filter((cookie) => isStaffCookie(cookie.name, config.url)),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          const previousCookies = response.cookies.getAll();
          response = NextResponse.next({ request });
          previousCookies.forEach((cookie) => response.cookies.set(cookie));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, {
              ...options,
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
              sameSite: "lax",
              path: "/",
            }),
          );
        },
      },
    },
  );

  // Refresh identity only. Layouts, data queries and actions independently
  // verify staff identity and current restaurant membership.
  await refreshForRouting(() => supabase.auth.getClaims());
  // Guest cookies are HttpOnly and use a separate storage key. Refreshing them
  // never reads, replaces, or signs out the staff/browser-client session.
  if (
    request.cookies
      .getAll()
      .some((cookie) => isGuestCookie(cookie.name, config.url))
  ) {
    const policy = guestCookieOptions(config.url);
    const guest = createServerClient<Database>(
      config.url,
      config.publishableKey,
      {
        cookieOptions: policy,
        global: {
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              cache: "no-store",
              signal: init?.signal
                ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)])
                : AbortSignal.timeout(10000),
            }),
        },
        cookies: {
          getAll: () =>
            request.cookies
              .getAll()
              .filter((cookie) => isGuestCookie(cookie.name, config.url)),
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            const previousCookies = response.cookies.getAll();
            response = NextResponse.next({ request });
            previousCookies.forEach((cookie) => response.cookies.set(cookie));
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, {
                ...options,
                httpOnly: policy.httpOnly,
                secure: policy.secure,
                sameSite: policy.sameSite,
                path: policy.path,
              }),
            );
          },
        },
      },
    );
    await refreshForRouting(() => guest.auth.getClaims());
  }
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}
