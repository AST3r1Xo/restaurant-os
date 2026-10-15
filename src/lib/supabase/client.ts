"use client";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseConfig } from "@/lib/env";
import type { Database } from "@/types/database";

// Realtime receives only a short-lived access token in memory. No refresh token,
// browser Auth persistence or cookies: guest and staff identities cannot collide.
export function createClient(accessToken: () => Promise<string | null>) {
  const { url, publishableKey } = requireSupabaseConfig();
  return createSupabaseClient<Database>(url, publishableKey, {
    accessToken,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
