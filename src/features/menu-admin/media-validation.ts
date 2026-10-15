import sharp from "sharp";
import { createHash } from "node:crypto";
export const MAX_UPLOAD_BYTES = 4_000_000;
export const MEDIA_BUCKET = "restaurant-media";
export type MediaKind = "photo" | "poster" | "glb" | "usdz" | "logo" | "cover";
export type ValidatedMedia = {
  bytes: Buffer;
  contentType: string;
  extension: string;
  sha256: string;
  dimensions?: number[];
};
function invalid(message: string): never {
  throw new Error(message);
}
const imageMagic = (b: Buffer) =>
  b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "png"
    : b[0] === 255 && b[1] === 216 && b[2] === 255
      ? "jpeg"
      : b.toString("ascii", 0, 4) === "RIFF" &&
          b.toString("ascii", 8, 12) === "WEBP"
        ? "webp"
        : undefined;
async function inspectImage(bytes: Buffer, maxDimension = 8192) {
  if (!imageMagic(bytes)) invalid("Choose a real JPEG, PNG or WebP image.");
  const image = sharp(bytes, {
    limitInputPixels: 24_000_000,
    failOn: "warning",
    animated: false,
  });
  const meta = await image.metadata();
  if (
    !meta.width ||
    !meta.height ||
    meta.width > maxDimension ||
    meta.height > maxDimension ||
    (meta.pages ?? 1) > 1
  )
    invalid("Use a still image within the supported dimensions.");
  await image.clone().raw().toBuffer(); // Decode the complete image, not just its declared MIME/header.
  return image;
}
function integer(v: unknown, min: number, max: number): v is number {
  return (
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max
  );
}
// Static, embedded GLB 2.0 only. Export transforms baked in metres; this keeps
// physical bounds auditable without another rendering engine on the server.
export async function inspectGlb(b: Buffer): Promise<number[]> {
  if (
    b.length < 28 ||
    b.toString("ascii", 0, 4) !== "glTF" ||
    b.readUInt32LE(4) !== 2 ||
    b.readUInt32LE(8) !== b.length
  )
    invalid("The file is not a complete GLB 2.0 model.");
  const len = b.readUInt32LE(12);
  if (
    len % 4 ||
    len < 2 ||
    20 + len + 8 > b.length ||
    b.readUInt32LE(16) !== 0x4e4f534a
  )
    invalid("Invalid GLB JSON chunk.");
  // JSON is bounded by the overall upload cap. Reject extension execution paths.
  const j = JSON.parse(b.toString("utf8", 20, 20 + len));
  const binOffset = 28 + len,
    binLength = b.readUInt32LE(20 + len);
  if (
    binLength % 4 ||
    b.readUInt32LE(24 + len) !== 0x004e4942 ||
    binOffset + binLength !== b.length ||
    j.asset?.version !== "2.0" ||
    j.extensionsRequired?.length ||
    j.extensionsUsed?.length ||
    j.animations?.length ||
    j.skins?.length
  )
    invalid(
      "Export a static, uncompressed GLB with embedded textures and baked transforms.",
    );
  if (
    j.buffers?.length !== 1 ||
    j.buffers[0].uri ||
    !integer(j.buffers[0].byteLength, 1, binLength) ||
    binLength - j.buffers[0].byteLength > 3
  )
    invalid("All model resources must be embedded in this file.");
  const bin = b.subarray(binOffset, binOffset + j.buffers[0].byteLength);
  if (
    !Array.isArray(j.bufferViews) ||
    j.bufferViews.length > 512 ||
    !Array.isArray(j.accessors) ||
    j.accessors.length > 512 ||
    !Array.isArray(j.nodes) ||
    j.nodes.length > 128 ||
    !Array.isArray(j.meshes) ||
    j.meshes.length > 64
  )
    invalid("The model is too complex for a mobile preview.");
  for (const v of j.bufferViews) {
    if (
      v.buffer !== 0 ||
      !integer(v.byteOffset ?? 0, 0, bin.length) ||
      !integer(v.byteLength, 1, bin.length) ||
      (v.byteOffset ?? 0) + v.byteLength > bin.length ||
      v.extensions
    )
      invalid("Invalid embedded model buffer.");
  }
  const widths: Record<number, number> = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
  };
  const components: Record<string, number> = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT4: 16,
  };
  for (const a of j.accessors) {
    const v = j.bufferViews[a.bufferView],
      w = widths[a.componentType],
      c = components[a.type];
    if (
      !v ||
      !w ||
      !c ||
      a.sparse ||
      a.extensions ||
      !integer(a.count, 1, 300000) ||
      !integer(a.byteOffset ?? 0, 0, v.byteLength)
    )
      invalid("Invalid model vertex data.");
    const stride = v.byteStride ?? w * c;
    if (
      !integer(stride, w * c, 252) ||
      stride % w ||
      (a.byteOffset ?? 0) + (a.count - 1) * stride + w * c > v.byteLength
    )
      invalid("Invalid model vertex stride.");
  }
  let triangles = 0,
    vertices = 0;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  const visited = new Set<number>(),
    meshes = new Set<number>();
  function visit(index: number) {
    if (!integer(index, 0, j.nodes.length - 1) || visited.has(index))
      invalid("Invalid model hierarchy.");
    visited.add(index);
    const node = j.nodes[index];
    if (
      node.matrix ||
      node.translation?.some((v: number) => v !== 0) ||
      node.scale?.some((v: number) => v !== 1) ||
      (node.rotation && JSON.stringify(node.rotation) !== "[0,0,0,1]") ||
      node.skin !== undefined ||
      node.weights ||
      node.extensions
    )
      invalid(
        "Bake all model transforms before uploading. Export in metres with the base at height zero.",
      );
    if (node.mesh !== undefined) {
      if (!integer(node.mesh, 0, j.meshes.length - 1))
        invalid("Invalid model mesh.");
      meshes.add(node.mesh);
    }
    for (const child of node.children ?? []) visit(child);
  }
  const scene = j.scenes?.[j.scene ?? 0];
  if (!scene || !Array.isArray(scene.nodes))
    invalid("The model needs a default scene.");
  for (const index of scene.nodes) visit(index);
  for (const index of meshes) {
    const mesh = j.meshes[index];
    if (
      !Array.isArray(mesh.primitives) ||
      mesh.primitives.length > 64 ||
      mesh.weights
    )
      invalid("Invalid model mesh.");
    for (const primitive of mesh.primitives) {
      if (
        (primitive.mode ?? 4) !== 4 ||
        primitive.targets ||
        primitive.extensions
      )
        invalid("Use a static triangle mesh.");
      const a = j.accessors[primitive.attributes?.POSITION];
      if (!a || a.type !== "VEC3" || a.componentType !== 5126 || a.normalized)
        invalid("Use uncompressed floating-point positions.");
      vertices += a.count;
      if (vertices > 150000) invalid("Keep the model below 150,000 vertices.");
      const v = j.bufferViews[a.bufferView],
        stride = v.byteStride ?? 12,
        offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
      for (let i = 0; i < a.count; i++)
        for (let k = 0; k < 3; k++) {
          const n = bin.readFloatLE(offset + i * stride + k * 4);
          if (!Number.isFinite(n)) invalid("Model coordinates must be finite.");
          min[k] = Math.min(min[k], n);
          max[k] = Math.max(max[k], n);
        }
      const indices =
        primitive.indices === undefined
          ? undefined
          : j.accessors[primitive.indices];
      if (
        primitive.indices !== undefined &&
        (!indices ||
          indices.type !== "SCALAR" ||
          ![5121, 5123, 5125].includes(indices.componentType))
      )
        invalid("Invalid model triangle indices.");
      if (indices) {
        const iv = j.bufferViews[indices.bufferView],
          size = widths[indices.componentType],
          start = (iv.byteOffset ?? 0) + (indices.byteOffset ?? 0);
        for (let i = 0; i < indices.count; i++) {
          const n = bin.readUIntLE(start + i * (iv.byteStride ?? size), size);
          if (n >= a.count)
            invalid("Model triangle references a missing vertex.");
        }
      }
      const count = indices?.count ?? a.count;
      if (count % 3) invalid("Incomplete model triangles.");
      triangles += count / 3;
      if (triangles > 100000)
        invalid("Keep the model below 100,000 triangles.");
    }
  }
  if (!triangles) invalid("The model has no visible dish geometry.");
  const dimensions = max.map((v, i) => v - min[i]);
  if (
    dimensions.some((n) => !Number.isFinite(n) || n < 0.003 || n > 1.2) ||
    Math.abs(min[1]) > 0.005
  )
    invalid(
      "Export at real dish size in metres, with its base at height zero (within 5 mm).",
    );
  if ((j.images?.length ?? 0) > 8 || (j.textures?.length ?? 0) > 8)
    invalid("Keep the model below eight textures.");
  for (const image of j.images ?? []) {
    const view = j.bufferViews[image.bufferView];
    if (
      image.uri ||
      !view ||
      !["image/png", "image/jpeg"].includes(image.mimeType)
    )
      invalid("Use embedded PNG or JPEG model textures.");
    const bytes = bin.subarray(
      view.byteOffset ?? 0,
      (view.byteOffset ?? 0) + view.byteLength,
    );
    if (imageMagic(bytes) !== (image.mimeType === "image/png" ? "png" : "jpeg"))
      invalid("Model texture format does not match its contents.");
    await inspectImage(bytes, 2048);
  }
  return dimensions;
}
function crc32(b: Buffer) {
  let crc = 0xffffffff;
  for (const byte of b) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function inspectUsdz(b: Buffer) {
  // USDZ is an uncompressed ZIP with aligned entries. Reject archive tricks,
  // traversal, encrypted/compressed entries and resources outside the package.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (
    eocd < 0 ||
    b.readUInt16LE(eocd + 4) ||
    b.readUInt16LE(eocd + 6) ||
    b.readUInt16LE(eocd + 8) !== b.readUInt16LE(eocd + 10) ||
    eocd + 22 + b.readUInt16LE(eocd + 20) !== b.length
  )
    invalid("Choose a valid single-volume USDZ package.");
  const count = b.readUInt16LE(eocd + 10),
    start = b.readUInt32LE(eocd + 16),
    end = start + b.readUInt32LE(eocd + 12);
  if (count < 1 || count > 128 || end !== eocd)
    invalid("Invalid USDZ package directory.");
  let at = start,
    previousEnd = 0;
  const names = new Set<string>(),
    texts: string[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || b.readUInt32LE(at) !== 0x02014b50)
      invalid("Invalid USDZ directory entry.");
    const flags = b.readUInt16LE(at + 8),
      method = b.readUInt16LE(at + 10),
      crc = b.readUInt32LE(at + 16),
      compressed = b.readUInt32LE(at + 20),
      size = b.readUInt32LE(at + 24),
      nl = b.readUInt16LE(at + 28),
      el = b.readUInt16LE(at + 30),
      cl = b.readUInt16LE(at + 32),
      local = b.readUInt32LE(at + 42);
    const name = b.toString("utf8", at + 46, at + 46 + nl);
    at += 46 + nl + el + cl;
    if (
      at > end ||
      (flags & ~2048) !== 0 ||
      method !== 0 ||
      compressed !== size ||
      size < 1 ||
      size > MAX_UPLOAD_BYTES ||
      !/^([a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(usd|usda|usdc|png|jpg|jpeg)$/.test(
        name,
      ) ||
      name.includes("..") ||
      names.has(name) ||
      local !== previousEnd ||
      local + 30 > start ||
      b.readUInt32LE(local) !== 0x04034b50
    )
      invalid(
        "Use a self-contained, uncompressed USDZ without unsafe filenames.",
      );
    const lnl = b.readUInt16LE(local + 26),
      lel = b.readUInt16LE(local + 28),
      dataStart = local + 30 + lnl + lel;
    if (
      dataStart % 64 ||
      dataStart + size > start ||
      b.toString("utf8", local + 30, local + 30 + lnl) !== name ||
      b.readUInt16LE(local + 6) !== flags ||
      b.readUInt16LE(local + 8) !== method ||
      b.readUInt32LE(local + 14) !== crc ||
      b.readUInt32LE(local + 18) !== size ||
      b.readUInt32LE(local + 22) !== size
    )
      invalid("USDZ files must use correctly aligned, matching ZIP entries.");
    const data = b.subarray(dataStart, dataStart + size);
    if (crc32(data) !== crc) invalid("The USDZ package contains damaged data.");
    if (i === 0 && !/\.(usd|usda|usdc)$/.test(name))
      invalid("The first USDZ entry must be the scene.");
    if (/\.(png|jpg|jpeg)$/.test(name)) await inspectImage(data, 2048);
    else {
      const text = data.toString("utf8");
      if (!text.startsWith("#usda 1.0") && !text.startsWith("PXR-USDC"))
        invalid("Unsupported USD scene format.");
      if (/https?:|file:|\.\.\//i.test(text))
        invalid("USDZ resources must stay inside the package.");
      if (text.startsWith("#usda")) texts.push(text);
    }
    names.add(name);
    previousEnd = dataStart + size;
  }
  if (at !== end || previousEnd !== start)
    invalid("Unexpected USDZ package contents.");
  for (const text of texts)
    for (const match of text.matchAll(/@([^@]+)@/g)) {
      if (!names.has(match[1]))
        invalid("A USD scene references a missing or external resource.");
    }
}
export async function validateMedia(
  kind: MediaKind,
  filename: string,
  contentType: string,
  bytes: Buffer,
): Promise<ValidatedMedia> {
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES)
    invalid("Files must be no larger than 4 MB.");
  if (
    typeof filename !== "string" ||
    filename.length > 180 ||
    /[\\/\x00-\x1f]/.test(filename)
  )
    invalid("Choose a file with a simple filename.");
  const ext = filename.split(".").at(-1)?.toLowerCase();
  let output = bytes,
    type = "",
    extension = "",
    dimensions: number[] | undefined;
  if (kind === "glb") {
    if (
      ext !== "glb" ||
      !["model/gltf-binary", "application/octet-stream", ""].includes(
        contentType,
      )
    )
      invalid("Choose a GLB model.");
    dimensions = await inspectGlb(bytes);
    type = "model/gltf-binary";
    extension = "glb";
  } else if (kind === "usdz") {
    if (
      ext !== "usdz" ||
      ![
        "model/vnd.usdz+zip",
        "application/zip",
        "application/octet-stream",
        "",
      ].includes(contentType)
    )
      invalid("Choose a USDZ model.");
    await inspectUsdz(bytes);
    type = "model/vnd.usdz+zip";
    extension = "usdz";
  } else if (["photo", "poster", "logo", "cover"].includes(kind)) {
    if (
      !["jpg", "jpeg", "png", "webp"].includes(ext ?? "") ||
      !["image/jpeg", "image/png", "image/webp"].includes(contentType)
    )
      invalid("Choose a JPEG, PNG or WebP photograph.");
    const actual = imageMagic(bytes);
    if (
      (ext === "jpg" ? "jpeg" : ext) !== actual ||
      contentType !== `image/${actual}`
    )
      invalid("The image format does not match its filename and content type.");
    const image = await inspectImage(bytes);
    output = await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 84 })
      .toBuffer();
    type = "image/webp";
    extension = "webp";
  } else invalid("Unsupported media type.");
  if (output.length > MAX_UPLOAD_BYTES)
    invalid("Optimize this asset to less than 4 MB.");
  return {
    bytes: output,
    contentType: type,
    extension,
    dimensions,
    sha256: createHash("sha256").update(output).digest("hex"),
  };
}
