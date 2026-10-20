"use client";

import { useEffect, useRef, useState } from "react";
import { CakeSlice, ChefHat, LayoutGrid, Search, Sprout, Star, Utensils, Wine, X } from "lucide-react";
import clsx from "clsx";
import type { RestaurantMenu } from "../types";
import { browseMenu, menuBrowsePath, productBrowsePath } from "../browse";
import type { MenuSelection } from "../browse";
import { ProductCard } from "./product-card";
import { useCart } from "@/features/cart/components/cart-provider";

function categoryIcon(id: string, name: string) {
  if (id === "all") return LayoutGrid;
  if (id === "favorites") return Star;
  if (/sweet|dessert|sobremesa/i.test(name)) return CakeSlice;
  if (/glass|drink|bebida|wine/i.test(name)) return Wine;
  if (/begin|starter|entrada/i.test(name)) return Sprout;
  if (/kitchen|main|prato/i.test(name)) return ChefHat;
  return Utensils;
}

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
  const categories = useRef<HTMLElement>(null);

  useEffect(() => {
    // Restore a category reached from a dish/refresh without moving the page.
    const nav = categories.current;
    const selected = nav?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (nav && selected) nav.scrollLeft = Math.max(0, selected.offsetLeft - nav.clientWidth / 2 + selected.clientWidth / 2);
  }, [selection.categoryId]);

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
        <div className="mx-auto max-w-5xl">
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
          <nav ref={categories} id="menu-category" aria-label="Menu categories" className="menu-category-strip relative -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 py-1 sm:-mx-8 sm:px-8">
            {[{ id: "all", name: "All dishes", count: result.total }, ...result.categories].map((category) => {
              const active = selection.categoryId === category.id;
              const Icon = categoryIcon(category.id, category.name);
              return (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={active}
                  aria-controls="menu-results"
                  onClick={() => update({ ...selection, categoryId: category.id })}
                  onFocus={(event) => {
                    const nav = categories.current;
                    const button = event.currentTarget;
                    if (nav && (button.offsetLeft < nav.scrollLeft || button.offsetLeft + button.offsetWidth > nav.scrollLeft + nav.clientWidth))
                      nav.scrollLeft = Math.max(0, button.offsetLeft - 20);
                  }}
                  className={clsx("inline-flex min-h-12 shrink-0 items-center gap-2.5 rounded-2xl border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-offset-[-3px]", active ? "border-accent bg-accent text-white shadow-sm" : "border-line bg-white text-muted hover:border-accent/35 hover:text-accent")}
                >
                  <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                  <span>{category.name}</span>
                  <span className={clsx("rounded-md px-1.5 py-0.5 text-[10px] tabular-nums", active ? "bg-white/15 text-white" : "bg-background text-muted")}>{category.count}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="py-3 text-xs text-muted">
        {result.count} {result.count === 1 ? "dish" : "dishes"}{selection.query.trim() ? ` matching “${selection.query.trim()}”` : " · Tap a dish to choose your options"}
      </p>
      {result.groups.length ? (
        <div id="menu-results" className="space-y-7">
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
        <div id="menu-results" className="rounded-2xl border border-dashed border-line bg-white/70 px-5 py-10 text-center">
          <Search size={24} className="mx-auto text-accent" aria-hidden="true" />
          <h2 className="mt-4 font-display text-2xl">No dishes found</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Try another dish or ingredient, or choose a different category.</p>
          <button type="button" onClick={() => update({ categoryId: "all", query: "" })} className="mt-4 min-h-11 rounded-full bg-accent px-5 text-sm font-medium text-white">Show all dishes</button>
        </div>
      )}
    </section>
  );
}
