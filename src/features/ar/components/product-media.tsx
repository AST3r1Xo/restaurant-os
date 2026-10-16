"use client";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useRef, useState } from "react";
import { Box, Leaf, Utensils, X } from "lucide-react";
import type { MenuProduct } from "@/features/menu/types";

const DishViewer = dynamic(
  () => import("./dish-viewer").then((m) => m.DishViewer),
  {
    ssr: false,
    loading: () => (
      <p
        role="status"
        className="flex h-full items-center justify-center p-8 text-sm text-muted"
      >
        Preparing your 3D preview…
      </p>
    ),
  },
);
export function ProductMedia({ product }: { product: MenuProduct }) {
  const [open, setOpen] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [failedImage, setFailedImage] = useState(false);
  const entry = useRef<HTMLButtonElement>(null);
  const asset = product.visualization;
  return (
    <div className="md:sticky md:top-6 md:self-start">
      <div
        className={`relative overflow-hidden rounded-3xl bg-accent-soft ${open ? "h-[520px] sm:h-[580px]" : "aspect-[4/3] md:aspect-[4/5]"}`}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            setOpen(false);
            requestAnimationFrame(() => entry.current?.focus());
          }
        }}
      >
        {open && asset ? (
          <>
            <div className="flex min-h-16 items-center justify-between gap-2 border-b border-line bg-background/90 px-5">
              <p className="min-w-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
                {asset.development
                  ? "Development ingredient study"
                  : "A new perspective"}
              </p>
              <button
                autoFocus
                type="button"
                onClick={() => {
                  setOpen(false);
                  requestAnimationFrame(() => entry.current?.focus());
                }}
                className="flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-1 text-xs text-muted"
                aria-label="Return to product photo"
              >
                <X size={16} aria-hidden="true" />
                Photo
              </button>
            </div>
            <div className="h-[calc(100%-4rem)]">
              <DishViewer
                key={attempt}
                asset={asset}
                attempt={attempt}
                retry={() => setAttempt((n) => n + 1)}
              />
            </div>
          </>
        ) : (
          <>
            {product.image && !failedImage ? (
              <Image
                src={product.image}
                alt={product.imageAlt}
                fill
                priority
                sizes="(max-width: 767px) 100vw, 520px"
                className="object-cover"
                onError={() => setFailedImage(true)}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-accent/40">
                <Utensils size={56} strokeWidth={1} aria-hidden="true" />
                <span className="sr-only">Dish image unavailable</span>
              </div>
            )}
            <div className="absolute inset-x-4 bottom-4 flex flex-wrap items-center justify-between gap-3">
              {product.tags[0] && (
                <span className="rounded-full bg-background/95 px-4 py-2 text-xs text-accent">
                  {product.tags[0]}
                </span>
              )}
              {asset && (
                <button
                  ref={entry}
                  type="button"
                  onClick={() => setOpen(true)}
                  className="ml-auto inline-flex min-h-12 items-center gap-2 rounded-full border border-white/40 bg-background/95 px-5 text-sm font-medium text-accent shadow-sm"
                  aria-expanded={open}
                >
                  <Box size={17} strokeWidth={1.6} aria-hidden="true" />
                  View in 3D
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {asset?.development ? (
        <div className="mt-4 rounded-2xl border border-accent/15 bg-white/50 px-4 py-3 text-[11px] leading-5 text-muted">
          <p className="font-medium text-accent">{asset.development.label}</p>
          <p className="mt-1">
            {asset.development.attribution}{" "}
            <a
              href={asset.development.source}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Asset source
            </a>
          </p>
        </div>
      ) : (
        asset && (
          <p className="mt-4 text-center text-xs leading-5 text-muted">
            A closer look at the presentation. Selected customizations aren’t
            reflected in the model.
          </p>
        )
      )}
      {open && asset?.dimensions && (
        <p className="mt-3 text-center text-[11px] text-muted">
          Model size:{" "}
          {asset.dimensions.map((n) => (n * 100).toFixed(1)).join(" × ")} cm ·
          width × height × depth
          {asset.development
            ? " · development reference size"
            : " · approximate"}
        </p>
      )}
      <p className="mt-4 hidden items-center justify-center gap-2 text-xs text-muted md:flex">
        <Leaf size={13} aria-hidden="true" />
        Thoughtfully prepared. Made for you.
      </p>
    </div>
  );
}
