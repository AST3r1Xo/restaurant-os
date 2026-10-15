"use client";

import { useState } from "react";
import clsx from "clsx";
import { Sprout } from "lucide-react";
import type { RestaurantMenu } from "../types";
import { ProductCard } from "./product-card";
import { useCart } from "@/features/cart/components/cart-provider";
import { productPath } from "@/lib/routes";

export function MenuBrowser({ menu }: { menu: RestaurantMenu }) {
  const { context } = useCart();
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  const [selected, setSelected] = useState(menu.categories[0]?.id);
  const category =
    menu.categories.find((item) => item.id === selected) ?? menu.categories[0];
  const products = menu.products.filter((product) =>
    category?.id === "favorites"
      ? product.tags.includes("House favorite")
      : product.categoryId === category?.id,
  );

  if (!category)
    return (
      <section className="mt-10 rounded-2xl border border-line bg-white/60 px-6 py-16 text-center">
        <Sprout size={24} className="mx-auto text-accent" aria-hidden="true" />
        <h2 className="mt-4 font-display text-3xl">
          Our kitchen is getting ready.
        </h2>
        <p className="mt-3 text-sm text-muted">
          The menu is being updated. Please ask our team for today’s dishes.
        </p>
      </section>
    );

  return (
    <section aria-labelledby="menu-heading" className="mt-10 sm:mt-14">
      <div
        className="-mx-5 flex gap-2 overflow-x-auto border-b border-line px-5 pb-5 sm:mx-0 sm:px-0"
        aria-label="Menu categories"
      >
        {menu.categories.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={category.id === item.id}
            onClick={() => setSelected(item.id)}
            className={clsx(
              "min-h-11 shrink-0 rounded-full border px-5 py-3 text-sm transition-colors",
              category.id === item.id
                ? "border-accent bg-accent text-white"
                : "border-line bg-white/40 text-muted hover:border-accent hover:text-accent",
            )}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="flex items-end justify-between gap-4 pb-6 pt-8">
        <div>
          <h2 id="menu-heading" className="font-display text-3xl sm:text-4xl">
            {category.name}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            {category.description}
          </p>
        </div>
        <span className="hidden shrink-0 text-xs text-muted sm:block">
          {products.length} {products.length === 1 ? "dish" : "dishes"}
        </span>
      </div>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {category.name}: {products.length}{" "}
        {products.length === 1 ? "dish" : "dishes"}
      </div>
      {products.length ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              currency={menu.currency}
              href={productPath(menu.slug, product.id, token)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line py-16 text-center">
          <Sprout size={24} className="text-accent" aria-hidden="true" />
          <h3 className="mt-4 font-display text-2xl">A little more to come.</h3>
          <p className="mt-2 max-w-xs px-5 text-sm leading-6 text-muted">
            No dishes are available in this category right now. Please ask our
            team for today’s suggestions.
          </p>
        </div>
      )}
    </section>
  );
}
