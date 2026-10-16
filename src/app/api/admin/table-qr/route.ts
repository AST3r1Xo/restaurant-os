import { getDataMode } from "@/lib/env";
import { uuid } from "@/features/menu-admin/validation";
import { loadTableQRs } from "@/features/restaurant-operations/qr-server";
import { publicQROrigin } from "@/features/restaurant-operations/qr-origin";
import {
  qrPNG,
  qrPDF,
  qrZIP,
  qrFilename,
} from "@/features/restaurant-operations/qr-artifacts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const noStore = {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    "X-Robots-Tag": "noindex, nofollow",
    Vary: "Cookie",
  };
  try {
    if (getDataMode() !== "live")
      return Response.json(
        { message: "QR downloads are disabled in demo preview." },
        { status: 400, headers: noStore },
      );
    const query = new URL(request.url).searchParams;
    const id = query.get("restaurant"),
      table = query.get("table"),
      format = query.get("format") ?? "png";
    if (
      !uuid(id) ||
      (table !== null && !uuid(table)) ||
      !["png", "pdf", "zip"].includes(format) ||
      (format === "png" && !table)
    )
      return Response.json(
        { message: "Choose a valid restaurant, table and download format." },
        { status: 400, headers: noStore },
      );
    // Verify Auth and current workspace membership before accessing any token.
    const { restaurant, tables } = await loadTableQRs(id);
    const origin = publicQROrigin(process.env.NEXT_PUBLIC_APP_URL);
    const active = tables.filter(
      (t) => t.is_active && (!table || t.id === table),
    );
    if (!active.length)
      return Response.json(
        { message: "This active table could not be found." },
        { status: 404, headers: noStore },
      );
    const bytes =
      format === "png"
        ? await qrPNG(origin, restaurant, active[0])
        : format === "pdf"
          ? await qrPDF(origin, restaurant, active)
          : await qrZIP(origin, restaurant, active);
    const name = table
      ? qrFilename(active[0].label, active[0].id)
      : restaurant.slug + "-table-codes";
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...noStore,
        "Content-Type":
          format === "png"
            ? "image/png"
            : format === "pdf"
              ? "application/pdf"
              : "application/zip",
        "Content-Disposition": `${query.get("preview") === "1" && format === "png" ? "inline" : "attachment"}; filename="${name}.${format}"`,
      },
    });
  } catch (e) {
    const configuration =
      e instanceof Error && e.message.startsWith("Printable QR codes need");
    const layout =
      e instanceof Error &&
      e.message.startsWith("This restaurant or table name cannot be typeset");
    return Response.json(
      {
        message:
          configuration || layout
            ? (e as Error).message
            : "QR codes could not be accessed. Sign in as an owner or manager and refresh your active workspace.",
      },
      { status: configuration ? 409 : layout ? 400 : 403, headers: noStore },
    );
  }
}
