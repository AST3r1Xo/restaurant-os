import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseConfig } from "@/lib/env";
import type { Database } from "@/types/database";
import { isStaffCookie, staffCookieOptions } from "./staff-cookie";

export async function createClient() {
  const { url, publishableKey } = requireSupabaseConfig();
  const cookieStore = await cookies();
  const policy = staffCookieOptions(url);
  return createServerClient<Database>(url, publishableKey, {
    cookieOptions: policy,
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        }),
    },
    cookies: {
      getAll: () =>
        cookieStore
          .getAll()
          .filter((cookie) => isStaffCookie(cookie.name, url)),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, {
              ...options,
              httpOnly: policy.httpOnly,
              secure: policy.secure,
              sameSite: policy.sameSite,
              path: policy.path,
            }),
          );
        } catch {
          // Server Components have read-only cookies. Proxy handles refresh;
          // mutations must use Server Actions/Route Handlers where cookies are writable.
        }
      },
    },
  });
}
