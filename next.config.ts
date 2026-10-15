import type { NextConfig } from "next";
import { getSupabaseConfig } from "./src/lib/env.ts";

// Validate public configuration before Next.js can inline it into any bundle.
const supabase = getSupabaseConfig();

const nextConfig: NextConfig = {
  typedRoutes: true,
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "64kb" } },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      ...(supabase
        ? [
            {
              protocol: "https" as const,
              hostname: new URL(supabase.url).hostname,
              pathname: "/storage/v1/object/public/**",
            },
          ]
        : []),
    ],
  },
};

export default nextConfig;
