"use client";
import Image from "next/image";
import { useState } from "react";
import {
  Plus,
  Search,
  ArrowUp,
  ArrowDown,
  Pencil,
  Box,
  Utensils,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button, Field, TextArea, Check, Section } from "./controls";
import { ProductEditor } from "./product-editor";
import {
  saveCategoryAction,
  moveEntryAction,
  refreshMenuAction,
} from "./actions";
import type { AdminProduct, Category, MenuWorkspace } from "./types";
export function MenuAdmin({
  initial,
  demo = false,
}: {
  initial: MenuWorkspace;
  demo?: boolean;
}) {
  const [workspace, setWorkspace] = useState(initial),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [status, setStatus] = useState("active"),
    [editor, setEditor] = useState<AdminProduct | null>(null),
    [editingCategory, setEditingCategory] = useState<Partial<Category> | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [saved, setSaved] = useState(""),
    [editorKey, setEditorKey] = useState(0);
  const r = workspace.restaurant;
  function update(w: MenuWorkspace) {
    setWorkspace(w);
    setMessage("");
  }
  async function refresh() {
    setBusy(true);
    const result = await refreshMenuAction(r.id);
    if (result.ok) update(result.data);
    else setMessage(result.message);
    setBusy(false);
  }
  async function move(
    id: string,
    kind: "category" | "product",
    direction: number,
  ) {
    setBusy(true);
    const result = await moveEntryAction(r.id, id, kind, direction);
    if (result.ok) update(result.data);
    else setMessage(result.message);
    setBusy(false);
  }
  async function saveCategory() {
    if (!editingCategory) return;
    setBusy(true);
    setMessage("");
    const result = await saveCategoryAction(
      r.id,
      editingCategory.id!,
      editingCategory.updated_at ?? null,
      {
        name: editingCategory.name ?? "",
        description: editingCategory.description ?? "",
        is_active: !!editingCategory.is_active,
      },
    );
    if (result.ok) {
      update(result.data);
      setEditingCategory(null);
      setSaved("Category saved.");
    } else setMessage(result.message);
    setBusy(false);
  }
  function create() {
    const now = "";
    setEditor({
      id: crypto.randomUUID(),
      restaurant_id: r.id,
      category_id: category || workspace.categories[0]?.id || "",
      name: "",
      description: "",
      price_minor: 0,
      image_url: null,
      model_glb_url: null,
      model_usdz_url: null,
      model_poster_url: null,
      model_dimensions_m: null,
      is_available: true,
      is_published: false,
      archived_at: null,
      model_verified: false,
      model_ar_enabled: false,
      sort_order: 0,
      allergens: [],
      ingredients: [],
      dietary_tags: [],
      created_at: now,
      updated_at: now,
      image_asset_id: null,
      model_asset_id: null,
      model_usdz_asset_id: null,
      model_poster_asset_id: null,
      groups: [],
      review: null,
    });
    setEditorKey((n) => n + 1);
  }
  if (editor)
    return (
      <ProductEditor
        key={`${editor.id}-${editorKey}`}
        product={editor}
        workspace={workspace}
        demo={demo}
        onSaved={(w) => {
          update(w);
          setEditor(w.products.find((p) => p.id === editor.id) ?? null);
          setEditorKey((n) => n + 1);
          setSaved(
            "Dish saved. Your customer menu reflects published changes.",
          );
        }}
        onClose={() => setEditor(null)}
      />
    );
  const products = workspace.products.filter(
    (p) =>
      (!category || p.category_id === category) &&
      (status === "all" ||
        (status === "archived" ? !!p.archived_at : !p.archived_at)) &&
      `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  const used = new Set([
    r.logo_asset_id,
    r.cover_asset_id,
    ...workspace.products.flatMap((p) => [
      p.image_asset_id,
      p.model_asset_id,
      p.model_usdz_asset_id,
      p.model_poster_asset_id,
    ]),
  ]);
  return (
    <div className="motion-enter">
      <header className="flex flex-wrap justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-accent">
            Your culinary story
          </p>
          <h1 className="mt-3 font-display text-4xl">The menu.</h1>
          <p className="mt-3 text-sm text-muted">
            Thoughtful dishes. Beautifully presented. Always up to date.
          </p>
        </div>
        <div className="flex items-start gap-2">
          <Button
            disabled={demo || busy}
            aria-label="Refresh menu workspace"
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} />
          </Button>
          <Button
            primary
            disabled={!workspace.categories.length}
            onClick={create}
          >
            <Plus size={17} />
            Create dish
          </Button>
        </div>
      </header>
      {demo && (
        <p className="mt-6 rounded-xl bg-accent-soft p-4 text-sm">
          Demo workspace · explore the editor. Saving and uploads are disabled.
        </p>
      )}
      {message && (
        <p
          role="alert"
          className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-800"
        >
          {message}
        </p>
      )}
      {saved && (
        <p
          role="status"
          className="mt-6 rounded-xl bg-accent-soft p-4 text-sm text-accent"
        >
          {saved}
        </p>
      )}
      <div className="mt-8 grid gap-7 xl:grid-cols-[240px_1fr]">
        <aside>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Categories</h2>
            <Button
              aria-label="Create category"
              onClick={() =>
                setEditingCategory({
                  id: crypto.randomUUID(),
                  name: "",
                  description: "",
                  is_active: false,
                })
              }
            >
              <Plus size={16} />
            </Button>
          </div>
          <div className="mt-4 space-y-2">
            <button
              className={`min-h-11 w-full rounded-xl px-3 text-left text-sm ${!category ? "bg-accent-soft font-medium text-accent" : "hover:bg-white"}`}
              onClick={() => setCategory("")}
            >
              All dishes{" "}
              <span className="float-right text-muted">
                {workspace.products.filter((p) => !p.archived_at).length}
              </span>
            </button>
            {workspace.categories.map((c, index) => (
              <div
                key={c.id}
                className={`rounded-xl border p-2 ${category === c.id ? "border-accent bg-accent-soft" : "border-line bg-white/60"}`}
              >
                <button
                  className="min-h-11 w-full px-1 text-left text-sm font-medium"
                  onClick={() => setCategory(c.id)}
                >
                  {c.name}
                  <span className="mt-1 block text-xs font-normal text-muted">
                    {c.is_active ? "Published" : "Unpublished"}
                  </span>
                </button>
                <div className="mt-1 flex gap-1">
                  <Button
                    aria-label={`Edit ${c.name}`}
                    onClick={() => setEditingCategory(c)}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    aria-label={`Move ${c.name} up`}
                    disabled={demo || busy || index === 0}
                    onClick={() => void move(c.id, "category", -1)}
                  >
                    <ArrowUp size={14} />
                  </Button>
                  <Button
                    aria-label={`Move ${c.name} down`}
                    disabled={
                      demo || busy || index === workspace.categories.length - 1
                    }
                    onClick={() => void move(c.id, "category", 1)}
                  >
                    <ArrowDown size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </aside>
        <div>
          <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_170px]">
            <label className="relative flex items-center rounded-xl border border-line bg-white px-4">
              <Search size={18} className="text-muted" />
              <input
                aria-label="Search dishes"
                placeholder="Search your dishes…"
                className="min-h-12 w-full bg-transparent pl-3 text-sm outline-none"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select
              aria-label="Filter dish status"
              className="min-h-12 rounded-xl border border-line bg-white px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="active">Current menu</option>
              <option value="archived">Archived dishes</option>
              <option value="all">All dishes</option>
            </select>
          </div>
          {!products.length && (
            <div className="rounded-2xl border border-dashed border-line p-12 text-center">
              <Utensils className="mx-auto text-accent" size={30} />
              <h2 className="mt-4 font-display text-2xl">
                Room for something delicious.
              </h2>
              <p className="mt-2 text-sm text-muted">
                {search
                  ? "No dishes match your search."
                  : "Create a category and add your first dish."}
              </p>
            </div>
          )}
          <div className="space-y-3">
            {products.map((p) => (
              <article
                key={p.id}
                className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-white p-4 transition hover:border-accent/40"
              >
                <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-accent-soft">
                  {p.image_url ? (
                    <Image
                      src={p.image_url}
                      alt=""
                      width={80}
                      height={80}
                      unoptimized
                      className="size-full object-cover"
                    />
                  ) : (
                    <Utensils size={24} className="text-accent/60" />
                  )}
                </div>
                <div className="min-w-36 flex-1">
                  <button
                    className="min-h-11 text-left font-medium"
                    onClick={() => {
                      setEditor(p);
                      setEditorKey((n) => n + 1);
                    }}
                  >
                    {p.name}
                  </button>
                  <p className="text-xs text-muted">
                    {
                      workspace.categories.find((c) => c.id === p.category_id)
                        ?.name
                    }{" "}
                    ·{" "}
                    {new Intl.NumberFormat("en", {
                      style: "currency",
                      currency: r.currency,
                    }).format(p.price_minor / 100)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    <span
                      className={`rounded-full px-2 py-1 ${p.archived_at ? "bg-stone-100" : p.is_published ? "bg-accent-soft text-accent" : "bg-amber-50 text-amber-800"}`}
                    >
                      {p.archived_at
                        ? "Archived"
                        : p.is_published
                          ? "Published"
                          : "Draft"}
                    </span>
                    {!p.is_available && !p.archived_at && (
                      <span className="rounded-full bg-stone-100 px-2 py-1 text-muted">
                        Unavailable
                      </span>
                    )}
                    {p.model_asset_id && (
                      <span className="flex items-center gap-1 rounded-full bg-background px-2 py-1">
                        <Box size={12} />
                        {p.model_ar_enabled
                          ? "AR enabled"
                          : p.model_verified
                            ? "3D ready"
                            : "3D needs review"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    aria-label={`Move ${p.name} up in its category`}
                    disabled={demo || busy || !!search || !!p.archived_at}
                    onClick={() => void move(p.id, "product", -1)}
                  >
                    <ArrowUp size={15} />
                  </Button>
                  <Button
                    aria-label={`Move ${p.name} down in its category`}
                    disabled={demo || busy || !!search || !!p.archived_at}
                    onClick={() => void move(p.id, "product", 1)}
                  >
                    <ArrowDown size={15} />
                  </Button>
                  <Button
                    onClick={() => {
                      setEditor(p);
                      setEditorKey((n) => n + 1);
                    }}
                  >
                    <Pencil size={15} />
                    Edit
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
      <details className="mt-8 rounded-2xl border border-line bg-white p-5">
        <summary className="min-h-11 text-sm font-medium">
          Unused media ·{" "}
          {workspace.assets.filter((a) => !used.has(a.id)).length} files
        </summary>
        <p className="mt-2 text-xs leading-6 text-muted">
          Replacing an asset keeps its previous file. Remove unused files here
          when you are ready. Files currently referenced by any dish or
          restaurant branding cannot be deleted.
        </p>
        <div className="mt-4 space-y-3">
          {workspace.assets
            .filter((a) => !used.has(a.id))
            .map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-background p-3 text-sm"
              >
                <span>
                  {a.kind.toUpperCase()} · {Math.round(a.byte_size / 1000)} KB ·{" "}
                  {new Date(a.created_at).toLocaleString()}
                  <span className="ml-2 text-xs text-muted">
                    {a.state === "ready"
                      ? "Ready"
                      : a.state === "pending"
                        ? "Upload incomplete"
                        : "Removal in progress"}
                  </span>
                </span>
                <Button
                  disabled={demo || busy}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        "Permanently remove this unused public file?",
                      )
                    )
                      return;
                    setBusy(true);
                    try {
                      const response = await fetch(
                        `/api/admin/media?id=${a.id}`,
                        {
                          method: "DELETE",
                          headers: { "x-restaurant-id": r.id },
                        },
                      );
                      const result = await response.json();
                      if (!result.ok) throw new Error(result.message);
                      await refresh();
                    } catch (e) {
                      setMessage(
                        e instanceof Error ? e.message : "Removal failed.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Trash2 size={15} />
                  Delete unused file
                </Button>
              </div>
            ))}
        </div>
      </details>
      {editingCategory && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit menu category"
          className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-foreground/30 p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditingCategory(null);
          }}
        >
          <div className="w-full max-w-lg rounded-3xl bg-background p-6 shadow-xl">
            <Section
              title={
                editingCategory.created_at ? "Edit category" : "Create category"
              }
            >
              <Field
                autoFocus
                label="Category name"
                value={editingCategory.name ?? ""}
                maxLength={120}
                onChange={(e) =>
                  setEditingCategory({
                    ...editingCategory,
                    name: e.target.value,
                  })
                }
              />
              <TextArea
                label="Description"
                value={editingCategory.description ?? ""}
                rows={3}
                onChange={(e) =>
                  setEditingCategory({
                    ...editingCategory,
                    description: e.target.value,
                  })
                }
              />
              <Check
                label="Published on the customer menu"
                checked={editingCategory.is_active ?? false}
                onChange={(e) =>
                  setEditingCategory({
                    ...editingCategory,
                    is_active: e.target.checked,
                  })
                }
              />
              {message && (
                <p role="alert" className="text-sm text-red-800">
                  {message}
                </p>
              )}
              <div className="flex justify-end gap-3">
                <Button
                  disabled={busy}
                  onClick={() => setEditingCategory(null)}
                >
                  Cancel
                </Button>
                <Button
                  primary
                  disabled={demo || busy}
                  onClick={() => {
                    if (
                      editingCategory.created_at &&
                      editingCategory.is_active === false &&
                      workspace.categories.find(
                        (c) => c.id === editingCategory.id,
                      )?.is_active &&
                      !window.confirm(
                        "Unpublish this category and hide its dishes from customers?",
                      )
                    )
                      return;
                    void saveCategory();
                  }}
                >
                  {busy ? "Saving…" : "Save category"}
                </Button>
              </div>
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}
