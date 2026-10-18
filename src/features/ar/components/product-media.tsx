"use client";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Box, Leaf, Utensils, X } from "lucide-react";
import type { MenuProduct } from "@/features/menu/types";
import { ModelDemonstrationNotice } from "./model-demonstration-notice";

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
  const dialog = useRef<HTMLDialogElement>(null);
  const asset = product.visualization;
  useEffect(() => {
    const modal = dialog.current;
    if (!open || !modal) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.showModal();
    return () => {
      modal.close();
      document.body.style.overflow = overflow;
    };
  }, [open]);
  return (
    <div className="md:sticky md:top-6 md:self-start">
      <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-accent-soft md:aspect-[4/5]">
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
              {asset.demonstration ? "View 3D demo" : "View in 3D"}
            </button>
          )}
        </div>
      </div>
      {asset && (
        <dialog
          ref={dialog}
          aria-label={`3D preview of ${product.name}`}
          onClose={() => {
            // Ignore a queued close event from an earlier Strict Mode cleanup
            // if the same dialog has already been opened again.
            if (dialog.current?.open) return;
            setOpen(false);
            entry.current?.focus();
          }}
          className="m-auto h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-background p-0 text-foreground backdrop:bg-black/40 sm:h-[min(760px,calc(100dvh-2rem))] sm:max-w-3xl sm:rounded-3xl"
        >
          {open && (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-b border-line px-5 pt-[env(safe-area-inset-top)]">
                <div className="min-w-0 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
                    {asset.development
                      ? "Development ingredient study"
                      : asset.demonstration
                        ? "3D demonstration"
                        : product.name}
                  </p>
                  {asset.demonstration || asset.development ? (
                    <p className="mt-1 text-[11px] leading-4 text-muted">
                      Sample model · portion size unverified · AR off
                    </p>
                  ) : asset.dimensions ? (
                    <p className="mt-1 text-[11px] leading-4 text-muted">
                      Model footprint: {(asset.dimensions[0] * 100).toFixed(1)} ×{" "}
                      {(asset.dimensions[2] * 100).toFixed(1)} cm
                    </p>
                  ) : null}
                </div>
                <button
                  autoFocus
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex min-h-12 shrink-0 items-center gap-1.5 whitespace-nowrap px-2 text-sm text-accent"
                  aria-label="Return to product photo"
                >
                  <X size={18} aria-hidden="true" />
                  Back to dish
                </button>
              </div>
              <div className="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]">
                <DishViewer
                  key={attempt}
                  asset={asset}
                  attempt={attempt}
                  retry={() => setAttempt((n) => n + 1)}
                />
              </div>
            </div>
          )}
        </dialog>
      )}
      {asset?.demonstration ? (
        <ModelDemonstrationNotice />
      ) : asset?.development ? (
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
      <p className="mt-4 hidden items-center justify-center gap-2 text-xs text-muted md:flex">
        <Leaf size={13} aria-hidden="true" />
        Thoughtfully prepared. Made for you.
      </p>
    </div>
  );
}
