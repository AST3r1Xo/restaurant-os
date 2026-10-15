import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseConfig } from "@/lib/env";
import type { Database } from "@/types/database";
import { guestCookieOptions, isGuestCookie } from "./guest-cookie";

// Writable mode is used only in Server Actions. Server Components may read
// existing sessions; the proxy refreshes their cookies before rendering.
export async function createGuestClient(writable = false) {
  const { url, publishableKey } = requireSupabaseConfig();
  const cookieStore = await cookies();
  const policy = guestCookieOptions(url);
  return createServerClient<Database>(url, publishableKey, {
    cookieOptions: policy,
    cookies: {
      getAll: () =>
        cookieStore
          .getAll()
          .filter((cookie) => isGuestCookie(cookie.name, url)),
      setAll(cookiesToSet) {
        if (!writable) return;
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, {
            ...options,
            httpOnly: policy.httpOnly,
            secure: policy.secure,
            sameSite: policy.sameSite,
            path: policy.path,
          }),
        );
      },
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)])
            : AbortSignal.timeout(20000),
        }),
    },
  });
}
