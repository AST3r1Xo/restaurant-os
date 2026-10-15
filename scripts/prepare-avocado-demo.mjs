// Offline asset preparation only; sharp is supplied by the pinned Next install.
// Usage: node scripts/prepare-avocado-demo.mjs /path/to/official/Avocado.glb
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { createHash } from "node:crypto";
const source = await readFile(process.argv[2]);
if (source.readUInt32LE(0) !== 0x46546c67 || source.readUInt32LE(4) !== 2)
  throw new Error("Expected GLB 2");
const jsonLength = source.readUInt32LE(12);
const doc = JSON.parse(source.subarray(20, 20 + jsonLength).toString());
const original = source.subarray(28 + jsonLength);
if (
  doc.nodes.length !== 1 ||
  doc.meshes.length !== 1 ||
  doc.images.length !== 3
)
  throw new Error("Unexpected source asset");
const buffers = [];
let offset = 0;
const imageByView = new Map(
  doc.images.map((image) => [image.bufferView, image]),
);
for (let i = 0; i < doc.bufferViews.length; i++) {
  const v = doc.bufferViews[i],
    image = imageByView.get(i);
  let bytes = Buffer.from(
    original.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength),
  );
  if (image) {
    bytes = await sharp(bytes)
      .resize({ width: 512, height: 512, fit: "inside" })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
  v.byteOffset = offset;
  v.byteLength = bytes.length;
  buffers.push(bytes);
  offset += bytes.length;
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    buffers.push(Buffer.alloc(pad));
    offset += pad;
  }
}
const bin = Buffer.concat(buffers);
const positions = doc.accessors[3],
  scale = 0.1 / (positions.max[1] - positions.min[1]);
const zMax = positions.max[2],
  yMiddle = (positions.max[1] + positions.min[1]) / 2;
const minimum = [Infinity, Infinity, Infinity],
  maximum = [-Infinity, -Infinity, -Infinity];
// Bake the source orientation/scale into geometry. Long axis is horizontal,
// bottom rests on Y=0. This is a declared 10 cm ingredient study, not a portion.
for (const name of ["POSITION", "NORMAL", "TANGENT"]) {
  const accessor = doc.accessors[doc.meshes[0].primitives[0].attributes[name]];
  const view = doc.bufferViews[accessor.bufferView],
    stride = view.byteStride ?? (name === "TANGENT" ? 16 : 12);
  for (let i = 0; i < accessor.count; i++) {
    const at = view.byteOffset + (accessor.byteOffset ?? 0) + i * stride;
    const [x, y, z] = [0, 4, 8].map((d) => bin.readFloatLE(at + d));
    const result =
      name === "POSITION"
        ? [-x * scale, (zMax - z) * scale, (yMiddle - y) * scale]
        : [-x, -z, -y];
    result.forEach((n, k) => {
      bin.writeFloatLE(n, at + k * 4);
      if (name === "POSITION") {
        minimum[k] = Math.min(minimum[k], n);
        maximum[k] = Math.max(maximum[k], n);
      }
    });
  }
}
positions.min = minimum;
positions.max = maximum;
delete doc.nodes[0].rotation;
doc.buffers[0].byteLength = bin.length;
doc.asset.generator =
  "Restaurant OS development avocado preparation; Microsoft CC0 source";
const json = Buffer.from(JSON.stringify(doc));
const jsonPad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20),
  body = Buffer.concat([json, jsonPad]);
const head = Buffer.alloc(20);
head.writeUInt32LE(0x46546c67);
head.writeUInt32LE(2, 4);
head.writeUInt32LE(28 + body.length + bin.length, 8);
head.writeUInt32LE(body.length, 12);
head.writeUInt32LE(0x4e4f534a, 16);
const binHead = Buffer.alloc(8);
binHead.writeUInt32LE(bin.length);
binHead.writeUInt32LE(0x004e4942, 4);
const output = Buffer.concat([head, body, binHead, bin]);
await writeFile("public/models/demo-mesa/eggs/avocado.glb", output);
const report = {
  source:
    "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Avocado",
  license: "CC0-1.0",
  author: "Microsoft",
  sourceSHA256: createHash("sha256").update(source).digest("hex"),
  sha256: createHash("sha256").update(output).digest("hex"),
  bytes: output.length,
  sourceBytes: source.length,
  triangles: doc.accessors[4].count / 3,
  textureMaxPixels: 512,
  dimensionsMetres: maximum.map((n, k) => n - minimum[k]),
  bottomMetres: minimum[1],
  externalResources: 0,
  modifications:
    "Textures resized to 512px PNG; unused image bytes removed; geometry baked horizontal, Y=0, 10cm length. No runtime scale. Not a restaurant dish or portion reference.",
};
await writeFile(
  "docs/assets/avocado-report.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
