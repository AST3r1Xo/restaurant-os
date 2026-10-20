"use client";

import { useRef, useState } from "react";
import { ChevronDown, Search, Sprout, X } from "lucide-react";
import type { RestaurantMenu } from "../types";
import { browseMenu, menuBrowsePath, productBrowsePath } from "../browse";
import type { MenuSelection } from "../browse";
import { ProductCard } from "./product-card";
import { useCart } from "@/features/cart/components/cart-provider";

export function MenuBrowser({ menu, initialSelection }: {
  menu: RestaurantMenu;
  initialSelection: MenuSelection;
}) {
  const { context } = useCart();
  const token = context.table.status === "valid" ? context.table.token : undefined;
  const [selection, setSelection] = useState(initialSelection);
  const start = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const result = browseMenu(menu, selection);

  function update(next: MenuSelection) {
    setSelection(next);
    // Native history keeps refresh/Back and product return links in sync,
    // without a server request per keystroke or any persisted guest data.
    try {
      window.history.replaceState(null, "", menuBrowsePath(menu.slug, token, next));
    } catch {
      // A blocked/throttled history API must not block search or ordering.
      // Product return links still carry the current selection explicitly.
    }
    if (start.current && start.current.getBoundingClientRect().top < 0) {
      start.current.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }

  if (!result.total) return (
    <section className="my-8 rounded-2xl border border-line bg-white px-6 py-12 text-center">
      <Sprout size={24} className="mx-auto text-accent" aria-hidden="true" />
      <h2 className="mt-4 font-display text-2xl">Our kitchen is getting ready.</h2>
      <p className="mt-3 text-sm leading-6 text-muted">The menu is being updated. Please ask our team for today’s dishes.</p>
    </section>
  );

  return (
    <section aria-label="Restaurant menu" className="pb-8">
      <div ref={start} className="menu-controls" aria-hidden="true" />
      <div className="sticky top-0 z-10 -mx-5 border-b border-line bg-background/95 px-5 pb-3 pt-3 backdrop-blur-md sm:-mx-8 sm:px-8">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(210px,0.6fr)]">
          <form role="search" onSubmit={(event) => { event.preventDefault(); search.current?.blur(); }}>
            <label htmlFor="menu-search" className="sr-only">Search dishes or ingredients</label>
            <div className="relative flex h-12 items-center rounded-xl border border-line bg-white focus-within:border-accent">
              <Search size={18} className="pointer-events-none absolute left-3.5 text-muted" aria-hidden="true" />
              <input
                ref={search}
                id="menu-search"
                type="search"
                maxLength={120}
                autoComplete="off"
                enterKeyHint="search"
                placeholder="Search the menu"
                value={selection.query}
                onChange={(event) => update({ ...selection, query: event.target.value })}
                className="menu-search h-full min-w-0 w-full rounded-xl bg-transparent pl-11 pr-12 text-base text-foreground placeholder:text-muted"
              />
              {selection.query && <button type="button" onClick={() => { update({ ...selection, query: "" }); search.current?.focus(); }} aria-label="Clear search" className="absolute right-0 flex size-12 items-center justify-center rounded-xl text-muted"><X size={17} aria-hidden="true" /></button>}
            </div>
          </form>
          <div className="relative">
            <label htmlFor="menu-category" className="sr-only">Menu category</label>
            <select
              id="menu-category"
              value={selection.categoryId}
              onChange={(event) => update({ ...selection, categoryId: event.target.value })}
              className="h-12 w-full appearance-none rounded-xl border border-accent/20 bg-accent-soft pl-4 pr-10 text-base font-medium text-accent"
            >
              <option value="all">All dishes · {result.total}</option>
              {result.categories.map((category) => <option key={category.id} value={category.id}>{category.name} · {category.count}</option>)}
            </select>
            <ChevronDown size={17} className="pointer-events-none absolute right-4 top-4 text-accent" aria-hidden="true" />
          </div>
        </div>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="py-3 text-xs text-muted">
        {result.count} {result.count === 1 ? "dish" : "dishes"}{selection.query.trim() ? ` matching “${selection.query.trim()}”` : " · Tap a dish to choose your options"}
      </p>
      {result.groups.length ? (
        <div className="space-y-7">
          {result.groups.map((group) => (
            <section key={group.id} aria-labelledby={`category-${group.id}`}>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 id={`category-${group.id}`} className="font-display text-2xl text-foreground">{group.name}</h2>
                <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs tabular-nums text-accent">{group.products.length}</span>
              </div>
              <div className="menu-dishes grid overflow-hidden rounded-2xl border border-line bg-white md:grid-cols-2">
                {group.products.map((product) => <ProductCard key={product.id} product={product} currency={menu.currency} href={productBrowsePath(menu.slug, product.id, token, selection)} />)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-line bg-white/70 px-5 py-10 text-center">
          <Search size={24} className="mx-auto text-accent" aria-hidden="true" />
          <h2 className="mt-4 font-display text-2xl">No dishes found</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Try another dish or ingredient, or choose a different category.</p>
          <button type="button" onClick={() => update({ categoryId: "all", query: "" })} className="mt-4 min-h-11 rounded-full bg-accent px-5 text-sm font-medium text-white">Show all dishes</button>
        </div>
      )}
    </section>
  );
}
