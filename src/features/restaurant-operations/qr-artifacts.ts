// Server/offline generation only. Never import these libraries into customer UI.
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { zipSync } from "fflate";
import { tableQRUrl } from "./qr-origin.ts";
export type QRTable = {
  id: string;
  label: string;
  qr_token: string;
  is_active: boolean;
  updated_at: string;
};
export type QRRestaurant = { name: string; slug: string };

export async function qrPNG(
  origin: string,
  restaurant: QRRestaurant,
  table: QRTable,
) {
  return QRCode.toBuffer(tableQRUrl(origin, restaurant.slug, table.qr_token), {
    type: "png",
    width: 1024,
    margin: 4,
    errorCorrectionLevel: "H",
    color: { dark: "#000000", light: "#ffffff" },
  });
}
export function qrFilename(label: string, id: string) {
  return `${
    label
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "table"
  }-${id.slice(0, 8)}`;
}
export async function qrPDF(
  origin: string,
  restaurant: QRRestaurant,
  tables: QRTable[],
) {
  if (!tables.length || tables.length > 100)
    throw new Error("Choose between 1 and 100 active tables to print.");
  const doc = await PDFDocument.create();
  doc.setTitle(`${restaurant.name} - table QR cards`);
  doc.setAuthor("Restaurant OS");
  const title = await doc.embedFont(StandardFonts.TimesRoman);
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const accent = rgb(0.18, 0.29, 0.23),
    muted = rgb(0.4, 0.43, 0.4);
  const width = 595.28,
    height = 841.89,
    margin = 28,
    gap = 12,
    cardW = (width - 2 * margin - gap) / 2,
    cardH = (height - 2 * margin - 2 * gap) / 3;
  let page = doc.addPage([width, height]);
  for (const [i, t] of tables.entries()) {
    if (i && i % 6 === 0) page = doc.addPage([width, height]);
    const slot = i % 6,
      x = margin + (slot % 2) * (cardW + gap),
      y = height - margin - Math.floor(slot / 2) * (cardH + gap) - cardH;
    page.drawRectangle({
      x,
      y,
      width: cardW,
      height: cardH,
      borderWidth: 0.6,
      borderColor: rgb(0.8, 0.83, 0.8),
      color: rgb(1, 1, 1),
    });
    function centered(
      text: string,
      font: typeof body,
      size: number,
      baseline: number,
      color = accent,
    ) {
      try {
        while (font.widthOfTextAtSize(text, size) > cardW - 32 && size > 8)
          size -= 0.5;
        if (font.widthOfTextAtSize(text, size) > cardW - 32) throw new Error();
        page.drawText(text, {
          font,
          size,
          x: x + (cardW - font.widthOfTextAtSize(text, size)) / 2,
          y: y + baseline,
          color,
        });
      } catch {
        throw new Error(
          "This restaurant or table name cannot be typeset in the printable card. Please use a shorter Latin-script display name for this PDF.",
        );
      }
    }
    centered(restaurant.name, title, 24, cardH - 37);
    centered(t.label, body, 13, cardH - 61);
    const png = await doc.embedPng(await qrPNG(origin, restaurant, t));
    const qrSize = 144;
    page.drawImage(png, {
      x: x + (cardW - qrSize) / 2,
      y: y + 39,
      width: qrSize,
      height: qrSize,
    });
    centered("Scan to explore & order", body, 10, 21, muted);
  }
  return doc.save();
}
export async function qrZIP(
  origin: string,
  restaurant: QRRestaurant,
  tables: QRTable[],
) {
  if (!tables.length || tables.length > 100)
    throw new Error("Choose between 1 and 100 active tables.");
  const files: Record<string, Uint8Array> = {};
  for (const t of tables)
    files[qrFilename(t.label, t.id) + ".png"] = await qrPNG(
      origin,
      restaurant,
      t,
    );
  return zipSync(files, { level: 0 });
}
