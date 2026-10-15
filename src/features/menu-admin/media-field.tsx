"use client";
import Image from "next/image";
import { useRef, useState } from "react";
import { Upload, Trash2, LoaderCircle } from "lucide-react";
import { Button } from "./controls";
import type { MediaAsset } from "./types";
import type { MediaKind } from "./media-validation";
export function MediaField({
  restaurantId,
  productId,
  kind,
  label,
  value,
  legacyUrl,
  assets,
  onChange,
  onAsset,
  disabled,
}: {
  restaurantId: string;
  productId?: string;
  kind: MediaKind;
  label: string;
  value: string | null;
  legacyUrl?: string | null;
  assets: MediaAsset[];
  onChange: (id: string | null) => void;
  onAsset: (a: MediaAsset) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [canRetry, setCanRetry] = useState(false);
  const pending = useRef<{ file: File; id: string } | null>(null),
    input = useRef<HTMLInputElement>(null);
  const available = assets.filter(
    (a) =>
      a.kind === kind &&
      a.product_id === (productId ?? null) &&
      a.state === "ready",
  );
  const current = available.find((a) => a.id === value),
    image = ["photo", "poster", "logo", "cover"].includes(kind);
  async function upload(file: File) {
    setMessage("");
    setCanRetry(false);
    if (file.size > 4_000_000) {
      setMessage("Choose a file smaller than 4 MB.");
      return;
    }
    if (pending.current?.file !== file)
      pending.current = { file, id: crypto.randomUUID() };
    setBusy(true);
    try {
      const response = await fetch("/api/admin/media", {
        method: "POST",
        headers: {
          "x-restaurant-id": restaurantId,
          ...(productId ? { "x-product-id": productId } : {}),
          "x-media-kind": kind,
          "x-upload-id": pending.current.id,
          "x-file-name": encodeURIComponent(file.name),
          "content-type": file.type || "application/octet-stream",
        },
        body: file,
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(result.message ?? "Upload failed.");
      onAsset(result.asset);
      onChange(result.asset.id);
      pending.current = null;
      setMessage("Uploaded and validated. Save the dish to apply this file.");
      if (input.current) input.current.value = "";
    } catch (e) {
      setCanRetry(true);
      setMessage(
        e instanceof Error
          ? e.message
          : "Upload could not be confirmed. Retry the same file.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-xl border border-line bg-background/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <span className="text-xs text-muted">
          {image ? "JPEG, PNG, WebP" : kind.toUpperCase()} · up to 4 MB
        </span>
      </div>
      {image && (current?.public_url || legacyUrl) && (
        <div className="mt-4 h-40 overflow-hidden rounded-xl bg-accent-soft">
          <Image
            src={current?.public_url ?? legacyUrl!}
            alt={`${label} preview`}
            width={600}
            height={300}
            unoptimized
            className="h-full w-full object-contain"
          />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl focus-within:outline-2 focus-within:outline-accent border border-line bg-white px-4 text-sm">
          <Upload size={16} aria-hidden="true" />
          {busy ? "Validating…" : current ? "Replace file" : "Upload file"}
          <input
            ref={input}
            aria-label={`Upload ${label}`}
            type="file"
            className="sr-only"
            accept={image ? "image/jpeg,image/png,image/webp" : `.${kind}`}
            disabled={disabled || busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
        {busy && (
          <LoaderCircle
            size={18}
            className="animate-spin"
            aria-label="Uploading"
          />
        )}
        {(value || legacyUrl) && (
          <Button
            type="button"
            disabled={disabled || busy}
            onClick={() => onChange(null)}
          >
            <Trash2 size={16} aria-hidden="true" />
            Remove from dish
          </Button>
        )}
        {canRetry && !busy && (
          <Button
            type="button"
            onClick={() => void upload(pending.current!.file)}
          >
            Retry upload
          </Button>
        )}
      </div>
      {available.length > 0 && (
        <label className="mt-3 block text-xs text-muted">
          Previously uploaded files
          <select
            aria-label={`Choose ${label}`}
            className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm"
            value={value ?? ""}
            disabled={disabled || busy}
            onChange={(e) => onChange(e.target.value || null)}
          >
            <option value="">No file selected</option>
            {available.map((a) => (
              <option key={a.id} value={a.id}>
                {new Date(a.created_at).toLocaleString()} ·{" "}
                {Math.round(a.byte_size / 1000)} KB · {a.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm leading-6 text-accent">
          {message}
        </p>
      )}
    </div>
  );
}
