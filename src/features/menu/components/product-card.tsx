"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import Image from "next/image";
import { Box, ChevronRight, Utensils } from "lucide-react";
import type { MenuProduct } from "../types";
import { formatMoney } from "@/lib/format";

export function ProductCard({ product, currency, href }: {
  product: MenuProduct;
  currency: string;
  href?: string;
}) {
  const [failedSource, setFailedSource] = useState<string>();
  const content = (
    <>
      <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-accent-soft sm:size-24">
        {product.image && product.image !== failedSource ? (
          <Image
            src={product.image}
            alt={product.imageAlt}
            fill
            sizes="(max-width: 639px) 80px, 96px"
            className="object-cover"
            onError={() => setFailedSource(product.image)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-accent/50">
            <Utensils size={25} strokeWidth={1.3} aria-hidden="true" />
            <span className="sr-only">Image unavailable for {product.name}</span>
          </div>
        )}
        {product.visualization && (
          <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded-md bg-background/95 px-1.5 py-1 text-[10px] font-semibold text-accent">
            <Box size={11} aria-hidden="true" />
            {product.visualization.demonstration || product.visualization.development ? "3D demo" : "3D"}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col self-stretch py-0.5">
        <h3 className="font-display text-lg leading-6 sm:text-xl">{product.name}</h3>
        {product.description && <p className="mt-1 line-clamp-1 text-xs leading-5 text-muted sm:line-clamp-2">{product.description}</p>}
        <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
          <span className="text-sm font-semibold tabular-nums text-accent">{formatMoney(product.priceMinor, currency)}</span>
          {href && <ChevronRight size={17} className="shrink-0 text-accent/70" aria-hidden="true" />}
        </div>
      </div>
    </>
  );
  const row = "flex h-full min-h-26 items-start gap-3 px-3 py-3 transition-colors hover:bg-accent-soft/45 focus-visible:outline-offset-[-3px] sm:gap-4 sm:px-4";
  return (
    <article id={`dish-${product.id}`} className="min-w-0 bg-white">
      {href ? (
        <Link href={href as Route} prefetch={false} className={row} aria-label={`Choose ${product.name}, ${formatMoney(product.priceMinor, currency)}${product.modifierGroups.length ? ", customization available" : ""}${product.visualization ? ", 3D preview available" : ""}`}>
          {content}
        </Link>
      ) : <div className={row}>{content}</div>}
    </article>
  );
}
