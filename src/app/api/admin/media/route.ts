import { headers } from "next/headers";
import { managerContext, adminError } from "@/features/menu-admin/server";
import { uuid } from "@/features/menu-admin/validation";
import {
  MAX_UPLOAD_BYTES,
  validateMedia,
  MEDIA_BUCKET,
} from "@/features/menu-admin/media-validation";
import type { MediaKind } from "@/features/menu-admin/media-validation";
import {
  mediaService,
  storeValidatedMedia,
} from "@/features/menu-admin/media-service";
import type { MediaAsset } from "@/features/menu-admin/types";
import { validateOrderOrigin } from "@/features/orders/request-protection";
export const runtime = "nodejs";
export const maxDuration = 60;
async function protect(request: Request) {
  const h = await headers(),
    origin = h.get("origin"),
    host = h.get("x-forwarded-host") ?? h.get("host");
  try {
    validateOrderOrigin(origin, host);
  } catch {
    throw new Error("Please upload from your restaurant workspace.");
  }
  const restaurant = h.get("x-restaurant-id");
  if (!uuid(restaurant)) throw new Error("Refresh your restaurant workspace.");
  const ctx = await managerContext(restaurant);
  if (request.method === "POST") {
    const length = Number(h.get("content-length"));
    if (
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > MAX_UPLOAD_BYTES
    )
      throw new Error("Files must be no larger than 4 MB.");
  }
  return ctx;
}
export async function POST(request: Request) {
  try {
    const { user, active } = await protect(request),
      h = request.headers;
    const id = h.get("x-upload-id"),
      product = h.get("x-product-id"),
      kind = h.get("x-media-kind") as MediaKind;
    if (
      !uuid(id) ||
      (product !== null && !uuid(product)) ||
      !["photo", "poster", "glb", "usdz", "logo", "cover"].includes(kind) ||
      (product === null) !== ["logo", "cover"].includes(kind)
    )
      throw new Error("Choose a valid dish and media type.");
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Choose a file to upload.");
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_UPLOAD_BYTES) {
          await reader.cancel();
          throw new Error("Files must be no larger than 4 MB.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const file = await validateMedia(
      kind,
      decodeURIComponent(h.get("x-file-name") ?? ""),
      h.get("content-type") ?? "",
      Buffer.concat(chunks),
    );
    const asset = await storeValidatedMedia(
      user.id,
      active.id,
      product,
      id,
      kind,
      file,
    );
    return Response.json(
      { ok: true, asset },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      { ok: false, message: adminError(e) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export async function DELETE(request: Request) {
  try {
    const { client, active } = await protect(request),
      id = new URL(request.url).searchParams.get("id");
    if (!uuid(id)) throw new Error("Choose a valid asset.");
    const { data, error } = await client.rpc("retire_menu_media", {
      target_restaurant: active.id,
      asset_id: id,
    });
    if (error) throw error;
    const asset = data as unknown as MediaAsset,
      service = mediaService();
    const removal = await service.storage
      .from(MEDIA_BUCKET)
      .remove([asset.object_path]);
    if (removal.error)
      throw new Error(
        "Removal could not be confirmed. Retry to finish removing this unused file.",
      );
    const result = await service
      .from("menu_media_assets")
      .update({ state: "deleted" })
      .eq("id", asset.id)
      .eq("state", "deleting");
    if (result.error) throw result.error;
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      { ok: false, message: adminError(e) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
