// Offline preparation only. Outputs remain ignored and are never published.
// Usage: node scripts/optimize-local-model.mjs .local-assets/yakitori/yakitori-momo.glb
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep, basename } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { validateMedia } from "../src/features/menu-admin/media-validation.ts";

const input = resolve(process.argv[2] ?? "");
const privateRoot = resolve(".local-assets") + sep;
if (!input.startsWith(privateRoot) || !input.endsWith(".glb"))
  throw new Error("Choose an unpublished GLB inside .local-assets.");
const source = await readFile(input);
if (
  source.toString("ascii", 0, 4) !== "glTF" ||
  source.readUInt32LE(4) !== 2 ||
  source.readUInt32LE(8) !== source.length
)
  throw new Error("Expected a complete GLB 2.0 file.");
const jsonLength = source.readUInt32LE(12);
const doc = JSON.parse(source.toString("utf8", 20, 20 + jsonLength));
const original = source.subarray(28 + jsonLength);
if (doc.buffers.length !== 1 || doc.buffers[0].uri)
  throw new Error("Expected embedded model resources.");
const images = new Map(doc.images.map((image) => [image.bufferView, image]));
if (images.size !== doc.images.length)
  throw new Error("Expected one embedded view per image.");
const colorTextures = new Set(
  doc.materials.flatMap((m) => {
    const t = m.pbrMetallicRoughness?.baseColorTexture;
    return t ? [doc.textures[t.index].source] : [];
  }),
);
const parts = [];
const textureReport = [];
let offset = 0;
for (let i = 0; i < doc.bufferViews.length; i++) {
  const v = doc.bufferViews[i];
  if (
    v.buffer !== 0 ||
    v.extensions ||
    (v.byteOffset ?? 0) + v.byteLength > original.length
  )
    throw new Error("Invalid model buffer.");
  let bytes = original.subarray(
    v.byteOffset ?? 0,
    (v.byteOffset ?? 0) + v.byteLength,
  );
  const image = images.get(i);
  if (image) {
    const color = colorTextures.has(doc.images.indexOf(image));
    const maxPixels = color ? 1024 : 512;
    const pipeline = sharp(bytes).resize({
      width: maxPixels,
      height: maxPixels,
      fit: "inside",
      withoutEnlargement: true,
    });
    bytes = color
      ? await pipeline
          .removeAlpha()
          .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
          .toBuffer()
      : await pipeline.png({ compressionLevel: 9 }).toBuffer();
    image.mimeType = color ? "image/jpeg" : "image/png";
    textureReport.push({
      name: image.name,
      maxPixels,
      bytes: bytes.length,
      mimeType: image.mimeType,
    });
  }
  v.byteOffset = offset;
  v.byteLength = bytes.length;
  parts.push(bytes);
  offset += bytes.length;
  const padding = (4 - (offset % 4)) % 4;
  if (padding) {
    parts.push(Buffer.alloc(padding));
    offset += padding;
  }
}
const bin = Buffer.concat(parts);
doc.buffers[0].byteLength = bin.length;
const json = Buffer.from(JSON.stringify(doc));
const body = Buffer.concat([
  json,
  Buffer.alloc((4 - (json.length % 4)) % 4, 0x20),
]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + body.length + bin.length, 8);
header.writeUInt32LE(body.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length);
binHeader.writeUInt32LE(0x004e4942, 4);
const output = Buffer.concat([header, body, binHeader, bin]);
// Run the actual upload gateway, including full image decoding and measured
// vertex bounds. This never invokes Storage or the media service credential.
const name = basename(input, ".glb") + "-optimized.glb";
const accepted = await validateMedia("glb", name, "model/gltf-binary", output);
const target = resolve(dirname(input), name);
await writeFile(target, accepted.bytes, { flag: "wx" });
const poster = await readFile(resolve(dirname(input), "yakitori-poster.png"));
const optimizedPoster = await validateMedia(
  "poster",
  "yakitori-poster.png",
  "image/png",
  poster,
);
await writeFile(
  resolve(dirname(input), "yakitori-poster.webp"),
  optimizedPoster.bytes,
  { flag: "wx" },
);
const report = {
  sourceBytes: source.length,
  bytes: accepted.bytes.length,
  sha256: accepted.sha256,
  sourceSHA256: createHash("sha256").update(source).digest("hex"),
  reductionPercent:
    Math.round((1 - accepted.bytes.length / source.length) * 1000) / 10,
  dimensionsMetresWidthHeightDepth: accepted.dimensions,
  triangles: doc.meshes
    .flatMap((m) => m.primitives)
    .reduce((n, p) => n + doc.accessors[p.indices].count / 3, 0),
  externalResources: 0,
  textures: textureReport,
  posterBytes: optimizedPoster.bytes.length,
  uploadByteValidationPassed: true,
  publicationApproved: false,
  physicalScaleVerified: false,
  arEnabled: false,
};
await writeFile(
  resolve(dirname(input), "validation-report.json"),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify(report, null, 2));
