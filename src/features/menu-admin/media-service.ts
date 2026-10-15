import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseConfig } from "@/lib/env";
import type { Database, Json } from "@/types/database";
import type { MediaAsset } from "./types";
import { MEDIA_BUCKET } from "./media-validation";
import type { MediaKind, ValidatedMedia } from "./media-validation";
// Privileged credentials are limited to the media gateway. All catalog writes,
// private orders, and identity checks continue using the staff/guest SSR client.
export function mediaService() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key)
    throw new Error(
      "Uploads are not configured. Ask the administrator to configure secure media storage.",
    );
  return createClient<Database>(requireSupabaseConfig().url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
export async function storeValidatedMedia(
  actor: string,
  restaurant: string,
  product: string | null,
  id: string,
  kind: MediaKind,
  file: ValidatedMedia,
) {
  const client = mediaService();
  const metadata = {
    sha256: file.sha256,
    byte_size: file.bytes.length,
    content_type: file.contentType,
    dimensions_m: file.dimensions ?? null,
    public_base: `${requireSupabaseConfig().url}/storage/v1/object/public/${MEDIA_BUCKET}/`,
  };
  const args = {
    actor,
    target_restaurant: restaurant,
    target_product: product as string,
    asset_id: id,
    asset_kind: kind,
    metadata: metadata as Json,
  };
  const { data, error } = await client.rpc("register_menu_media", args);
  if (error) throw error;
  const asset = data as unknown as MediaAsset;
  if (asset.state === "ready") return asset;
  const { error: uploadError } = await client.storage
    .from(MEDIA_BUCKET)
    .upload(asset.object_path, file.bytes, {
      contentType: file.contentType,
      upsert: false,
      cacheControl: "31536000",
    });
  if (uploadError) {
    // An uncertain response can leave the immutable file committed. Verify the
    // original bytes before completing the same upload; never overwrite a path.
    const { data: existing, error: downloadError } = await client.storage
      .from(MEDIA_BUCKET)
      .download(asset.object_path);
    if (downloadError || !existing)
      throw new Error(
        "The upload could not be confirmed. Keep this editor open and retry.",
      );
    const { createHash } = await import("node:crypto");
    if (
      createHash("sha256")
        .update(Buffer.from(await existing.arrayBuffer()))
        .digest("hex") !== file.sha256
    )
      throw new Error(
        "This upload reference is already in use. Choose the file again.",
      );
  }
  const ready = await client.rpc("register_menu_media", {
    ...args,
    make_ready: true,
  });
  if (ready.error) throw ready.error;
  return ready.data as unknown as MediaAsset;
}
