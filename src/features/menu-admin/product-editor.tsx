"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Plus,
  Box,
  CheckCircle2,
} from "lucide-react";
import { Button, Field, TextArea, Select, Check, Section } from "./controls";
import { MediaField } from "./media-field";
import { priceMinor, validateProduct } from "./validation";
import { saveProductAction, setModelDemonstrationAction } from "./actions";
import type {
  AdminProduct,
  MenuWorkspace,
  ProductDefinition,
  MediaAsset,
} from "./types";
const DishViewer = dynamic(
  () =>
    import("@/features/ar/components/dish-viewer").then((m) => m.DishViewer),
  {
    ssr: false,
    loading: () => (
      <p className="p-8" role="status">
        Preparing preview…
      </p>
    ),
  },
);
function definition(p: AdminProduct): ProductDefinition {
  return {
    name: p.name,
    description: p.description,
    category_id: p.category_id,
    price_minor: p.price_minor,
    ingredients: p.ingredients,
    allergens: p.allergens,
    dietary_tags: p.dietary_tags,
    is_available: p.is_available,
    status: p.archived_at ? "archived" : p.is_published ? "published" : "draft",
    keep_legacy_image: !p.image_asset_id,
    image_asset_id: p.image_asset_id,
    model_asset_id: p.model_asset_id,
    model_usdz_asset_id: p.model_usdz_asset_id,
    model_poster_asset_id: p.model_poster_asset_id,
    model_verified: p.model_verified,
    model_ar_enabled: p.model_ar_enabled,
    review: {
      license: p.review?.license ?? "",
      provenance: p.review?.provenance ?? "",
      measurement_notes: p.review?.measurement_notes ?? "",
      confirmed: p.model_verified,
    },
    groups: p.groups.map((g) => ({
      ...g,
      selection_type: g.selection_type as "single" | "multiple",
      options: g.options.map((o) => ({ ...o })),
    })),
  };
}
function moved<T>(items: T[], index: number, delta: number) {
  const next = [...items],
    target = index + delta;
  if (target >= 0 && target < next.length)
    [next[index], next[target]] = [next[target], next[index]];
  return next;
}
export function ProductEditor({
  product,
  workspace,
  demo,
  onSaved,
  onClose,
  initialTab = "details",
  notice,
}: {
  product: AdminProduct;
  workspace: MenuWorkspace;
  demo: boolean;
  onSaved: (w: MenuWorkspace, tab: string) => void;
  initialTab?: string;
  notice?: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => definition(product)),
    [price, setPrice] = useState((product.price_minor / 100).toFixed(2)),
    [assets, setAssets] = useState(workspace.assets),
    [tab, setTab] = useState(initialTab),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [preview, setPreview] = useState(false),
    [attempt, setAttempt] = useState(0),
    [dirty, setDirty] = useState(false),
    [reordering, setReordering] = useState(false);
  const [demoRights, setDemoRights] = useState(false);
  async function changeDemonstration() {
    if (dirty || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await setModelDemonstrationAction(
        workspace.restaurant.id,
        product.id,
        product.updated_at,
        !product.model_demo_enabled,
        demoRights,
      );
      if (result.ok) onSaved(result.data, tab);
      else setMessage(result.message);
    } catch {
      setMessage(
        "The 3D presentation change could not be confirmed. Refresh before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  const fresh = !product.created_at;
  const patch = (v: Partial<ProductDefinition>) => {
    setDraft((d) => ({ ...d, ...v }));
    setDirty(true);
  };
  function group(
    index: number,
    v: Partial<ProductDefinition["groups"][number]>,
  ) {
    patch({
      groups: draft.groups.map((g, i) => (i === index ? { ...g, ...v } : g)),
    });
  }
  function assetChange(
    field:
      | "image_asset_id"
      | "model_asset_id"
      | "model_usdz_asset_id"
      | "model_poster_asset_id",
    id: string | null,
  ) {
    setDraft((current) => ({
      ...current,
      [field]: id,
      ...(field === "image_asset_id" ? { keep_legacy_image: false } : {}),
      ...(field === "model_asset_id" || field === "model_usdz_asset_id"
        ? {
          model_verified: false,
          model_ar_enabled: false,
          review: { ...current.review, confirmed: false },
        }
        : {}),
    }));
    setDirty(true);
    setPreview(false);
  }
  const assetProps = {
    restaurantId: workspace.restaurant.id,
    productId: product.id,
    assets,
    disabled: demo || fresh || busy,
    onAsset: (a: MediaAsset) =>
      setAssets((s) => [a, ...s.filter((x) => x.id !== a.id)]),
  };
  async function save() {
    setMessage("");
    try {
      const payload = {
        ...draft,
        price_minor: priceMinor(price),
        ingredients: draft.ingredients.map((s) => s.trim()).filter(Boolean),
        allergens: draft.allergens.map((s) => s.trim()).filter(Boolean),
        dietary_tags: draft.dietary_tags.map((s) => s.trim()).filter(Boolean),
      };
      validateProduct(payload);
      if (
        payload.status !==
        (product.archived_at
          ? "archived"
          : product.is_published
            ? "published"
            : "draft") &&
        !window.confirm(
          payload.status === "archived"
            ? "Archive this dish? It will leave the customer menu. Historical orders will be retained."
            : payload.status === "draft"
              ? "Unpublish this dish and hide it from the customer menu?"
              : "Publish this dish to the customer menu?",
        )
      )
        return;
      setBusy(true);
      const result = await saveProductAction(
        workspace.restaurant.id,
        product.id,
        fresh ? null : product.updated_at,
        payload,
      );
      if (!result.ok) throw new Error(result.message);
      onSaved(result.data, tab);
      setDirty(false);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "The dish could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  const glb = assets.find((a) => a.id === draft.model_asset_id),
    poster = assets.find((a) => a.id === draft.model_poster_asset_id);
  const previewAsset = useMemo(
    () =>
      glb
        ? {
          src: glb.public_url,
          poster: poster?.public_url,
          alt: `Staff preview of ${draft.name}`,
          dimensions: glb.dimensions_m as [number, number, number],
          arEnabled: false,
        }
        : null,
    [glb, poster, draft.name],
  );
  return (
    <div className="motion-enter">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button
            onClick={() => {
              if (
                !dirty ||
                window.confirm("Discard your unsaved dish changes?")
              )
                onClose();
            }}
          >
            <ArrowLeft size={16} />
            All dishes
          </Button>
          <h1 className="mt-5 font-display text-3xl">
            {fresh ? "Create a dish" : product.name}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {fresh
              ? "Start with the essentials. Save a draft before uploading media."
              : "Changes apply to the menu. Existing order records stay unchanged."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">
            {dirty ? "Unsaved changes" : "Saved version"}
          </span>
        </div>
      </div>
      {demo && (
        <p className="mb-5 rounded-xl bg-accent-soft p-4 text-sm">
          Demo preview · editing is local only. Saving and uploading are
          disabled.
        </p>
      )}
      {notice && !message && (
        <p
          role="status"
          className="mb-5 rounded-xl bg-accent-soft p-4 text-sm text-accent"
        >
          {notice}
        </p>
      )}
      {message && (
        <p
          role="alert"
          className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {message}
        </p>
      )}
      <div
        role="tablist"
        aria-label="Dish editor sections"
        className="mb-6 -mx-2 flex gap-2 overflow-auto p-2"
      >
        {[
          ["details", "Details"],
          ["customizations", "Options"],
          ["media", "Photos & 3D"],
        ].map(([id, label]) => (
          <Button
            key={id}
            id={`editor-tab-${id}`}
            role="tab"
            className="shrink-0 whitespace-nowrap"
            tabIndex={tab === id ? 0 : -1}
            onKeyDown={(e) => {
              const keys = ["details", "customizations", "media"];
              const step =
                e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (step || e.key === "Home" || e.key === "End") {
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? keys[0]
                    : e.key === "End"
                      ? keys[2]
                      : keys[(keys.indexOf(id) + step + 3) % 3];
                setTab(next);
                document.getElementById(`editor-tab-${next}`)?.focus();
              }
            }}
            aria-selected={tab === id}
            aria-controls={`editor-${id}`}
            selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div
        id={`editor-${tab}`}
        role="tabpanel"
        aria-labelledby={`editor-tab-${tab}`}
        tabIndex={0}
        className="max-w-4xl space-y-6"
      >
        {tab === "details" && (
          <>
            <Section
              title="On the menu"
              description="Enter the name and price, then choose whether customers can see this dish."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Dish name"
                  value={draft.name}
                  maxLength={160}
                  onChange={(e) => patch({ name: e.target.value })}
                />
                <Select
                  label="Category"
                  value={draft.category_id}
                  onChange={(e) => patch({ category_id: e.target.value })}
                >
                  <option value="">Choose a category</option>
                  {workspace.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {!c.is_active ? " · unpublished" : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <TextArea
                label="Description"
                value={draft.description}
                rows={4}
                maxLength={4000}
                onChange={(e) => patch({ description: e.target.value })}
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label={`Price · ${workspace.restaurant.currency}`}
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setDirty(true);
                  }}
                />
                <Select
                  label="Show on menu"
                  value={draft.status}
                  onChange={(e) =>
                    patch({
                      status: e.target.value as ProductDefinition["status"],
                    })
                  }
                >
                  <option value="draft">Hidden · draft</option>
                  <option value="published">Visible to customers</option>
                  <option value="archived">
                    Archived · retained for your records
                  </option>
                </Select>
              </div>
              <Check
                label="Available to order"
                checked={draft.is_available}
                disabled={draft.status === "archived"}
                onChange={(e) => patch({ is_available: e.target.checked })}
              />
              <p className="text-xs leading-5 text-muted">
                Published dishes appear only when their category and restaurant
                are also published. Unavailable dishes are hidden from the
                customer menu.
              </p>
            </Section>
            <Section
              title="Ingredients & dietary information"
              description="Separate entries with commas. Keep allergen information accurate."
            >
              <TextArea
                label="Ingredients"
                value={draft.ingredients.join(", ")}
                onChange={(e) =>
                  patch({
                    ingredients: e.target.value
                      .split(",")
                      .map((s) => s.trimStart()),
                  })
                }
              />
              <TextArea
                label="Allergens"
                value={draft.allergens.join(", ")}
                onChange={(e) =>
                  patch({
                    allergens: e.target.value
                      .split(",")
                      .map((s) => s.trimStart()),
                  })
                }
              />
              <Field
                label="Dietary labels"
                hint="For example: vegetarian, plant-based, house-favorite"
                value={draft.dietary_tags.join(", ")}
                onChange={(e) =>
                  patch({
                    dietary_tags: e.target.value
                      .split(",")
                      .map((s) => s.trimStart()),
                  })
                }
              />
            </Section>
          </>
        )}
        {tab === "customizations" && (
          <Section
            title="Customer options"
            description="Add choices such as bread, cooking preference or extras."
          >
            {draft.groups.length > 0 && <Button selected={reordering} aria-pressed={reordering} onClick={() => setReordering((v) => !v)}>{reordering ? "Done reordering" : "Reorder options"}</Button>}
            {draft.groups.length === 0 && (
              <p className="rounded-xl bg-background p-6 text-sm text-muted">
                No customizations yet. Add a choice of bread, sides or extras.
              </p>
            )}
            {draft.groups.map((g, index) => (
              <div
                key={g.id}
                className="rounded-xl border border-line bg-background/50 p-4 sm:p-5"
              >
                <div className="mb-4 flex justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Group {index + 1}
                  </span>
                  {reordering && <div className="flex gap-1">
                    <Button
                      aria-label={`Move ${g.name || "group"} up`}
                      disabled={index === 0}
                      onClick={() =>
                        patch({ groups: moved(draft.groups, index, -1) })
                      }
                    >
                      <ArrowUp size={16} />
                    </Button>
                    <Button
                      aria-label={`Move ${g.name || "group"} down`}
                      disabled={index === draft.groups.length - 1}
                      onClick={() =>
                        patch({ groups: moved(draft.groups, index, 1) })
                      }
                    >
                      <ArrowDown size={16} />
                    </Button>
                  </div>}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Group name"
                    value={g.name}
                    onChange={(e) => group(index, { name: e.target.value })}
                  />
                  <Select
                    label="Selection style"
                    value={g.selection_type}
                    onChange={(e) =>
                      group(index, {
                        selection_type: e.target.value as "single" | "multiple",
                        max_selections:
                          e.target.value === "single" ? 1 : g.max_selections,
                        min_selections:
                          e.target.value === "single"
                            ? Math.min(1, g.min_selections)
                            : g.min_selections,
                      })
                    }
                  >
                    <option value="single">Choose one</option>
                    <option value="multiple">Choose several</option>
                  </Select>
                  {g.selection_type === "multiple" ? <Field
                    label="Minimum choices (0 = optional)"
                    type="number"
                    min={0}
                    max={20}
                    value={g.min_selections}
                    onChange={(e) =>
                      group(index, { min_selections: Number(e.target.value) })
                    }
                  /> : <Check label="Customer must choose an option" checked={g.min_selections > 0} onChange={(e) => group(index, { min_selections: e.target.checked ? 1 : 0 })} />}
                  {g.selection_type === "multiple" && <Field
                    label="Maximum choices"
                    type="number"
                    min={1}
                    max={20}
                    value={g.max_selections}
                    onChange={(e) =>
                      group(index, { max_selections: Number(e.target.value) })
                    }
                  />}
                </div>
                <Check
                  label="Show this group"
                  checked={g.is_active}
                  onChange={(e) =>
                    group(index, { is_active: e.target.checked })
                  }
                />
                <div className="mt-2 space-y-3">
                  {g.options.map((o, oi) => (
                    <div
                      key={o.id}
                      className="grid items-end gap-3 rounded-xl border border-line bg-white p-3 sm:grid-cols-[1fr_130px_auto]"
                    >
                      <Field
                        label={`Choice ${oi + 1}`}
                        value={o.name}
                        onChange={(e) =>
                          group(index, {
                            options: g.options.map((x, i) =>
                              i === oi ? { ...x, name: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      <OptionPrice
                        value={o.price_adjustment_minor}
                        onChange={(n) =>
                          group(index, {
                            options: g.options.map((x, i) =>
                              i === oi
                                ? { ...x, price_adjustment_minor: n }
                                : x,
                            ),
                          })
                        }
                      />
                      <div className="flex flex-wrap items-center gap-1">
                        <Check
                          label="Available"
                          checked={o.is_available}
                          onChange={(e) =>
                            group(index, {
                              options: g.options.map((x, i) =>
                                i === oi
                                  ? { ...x, is_available: e.target.checked }
                                  : x,
                              ),
                            })
                          }
                        />
                        {reordering && <>
                          <Button
                            aria-label="Move choice up"
                            disabled={oi === 0}
                            onClick={() =>
                              group(index, { options: moved(g.options, oi, -1) })
                            }
                          >
                            <ArrowUp size={14} />
                          </Button>
                          <Button
                            aria-label="Move choice down"
                            disabled={oi === g.options.length - 1}
                            onClick={() =>
                              group(index, { options: moved(g.options, oi, 1) })
                            }
                          >
                            <ArrowDown size={14} />
                          </Button>
                        </>}
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  className="mt-4"
                  disabled={g.options.length >= 20}
                  onClick={() =>
                    group(index, {
                      options: [
                        ...g.options,
                        {
                          id: crypto.randomUUID(),
                          name: "",
                          price_adjustment_minor: 0,
                          is_available: true,
                        },
                      ],
                    })
                  }
                >
                  <Plus size={16} />
                  Add choice
                </Button>
              </div>
            ))}
            <Button
              disabled={draft.groups.length >= 10}
              onClick={() =>
                patch({
                  groups: [
                    ...draft.groups,
                    {
                      id: crypto.randomUUID(),
                      name: "",
                      description: "",
                      selection_type: "single",
                      min_selections: 0,
                      max_selections: 1,
                      is_active: true,
                      options: [],
                    },
                  ],
                })
              }
            >
              <Plus size={16} />
              Add customization group
            </Button>
          </Section>
        )}
        {tab === "media" && (
          <>
            <Section
              title="Photography"
              description={
                fresh
                  ? "Save this dish as a draft first, then upload its photographs."
                  : "Images are checked, resized and stripped of metadata before publication."
              }
            >
              <MediaField
                {...assetProps}
                kind="photo"
                label="Product photograph"
                value={draft.image_asset_id}
                legacyUrl={draft.keep_legacy_image ? product.image_url : null}
                onChange={(id) => assetChange("image_asset_id", id)}
              />
            </Section>
            <details className="disclosure rounded-2xl border border-line bg-white p-5 sm:p-7">
              <summary className="text-base font-semibold">3D preview & AR · optional</summary>
              <Section
                title="3D & table placement"
                description="Use a model of this actual dish. Upload in metres, with transforms baked and the base at height zero. Unreviewed models remain hidden from customers."
              >
                <div className="flex items-center gap-2 rounded-xl bg-accent-soft p-4 text-sm text-accent">
                  {draft.model_verified ? (
                    <CheckCircle2 size={18} />
                  ) : (
                    <Box size={18} />
                  )}{" "}
                  {product.model_demo_enabled &&
                    !draft.model_verified &&
                    draft.model_asset_id === product.model_asset_id
                    ? "Demonstration · 3D only, no verified portion size"
                    : draft.model_ar_enabled
                      ? "Reviewed · table placement enabled"
                      : draft.model_verified
                        ? "Reviewed · interactive 3D enabled"
                        : glb
                          ? "Uploaded · review required"
                          : "No 3D model"}
                </div>
                <MediaField
                  {...assetProps}
                  kind="glb"
                  label="3D model"
                  value={draft.model_asset_id}
                  onChange={(id) => assetChange("model_asset_id", id)}
                />
                <MediaField
                  {...assetProps}
                  kind="usdz"
                  label="Optional iPhone model"
                  value={draft.model_usdz_asset_id}
                  onChange={(id) => assetChange("model_usdz_asset_id", id)}
                />
                <MediaField
                  {...assetProps}
                  kind="poster"
                  label="Model poster"
                  value={draft.model_poster_asset_id}
                  onChange={(id) => assetChange("model_poster_asset_id", id)}
                />
                {glb && (
                  <>
                    <div className="rounded-xl bg-background p-4 text-sm">
                      <p className="font-medium">Measured model dimensions</p>
                      <p className="mt-2 text-muted">
                        {glb.dimensions_m
                          ?.map((n) => (n * 100).toFixed(1))
                          .join(" × ")}{" "}
                        cm · width × height × depth
                      </p>
                      <p className="mt-2 text-xs leading-5 text-muted">
                        These values come from the uploaded geometry. Confirm them
                        against the physical dish. Correct the model in your 3D
                        authoring tool if they differ.
                      </p>
                    </div>
                    <Button onClick={() => setPreview((s) => !s)}>
                      <Box size={16} />
                      {preview ? "Close preview" : "Preview in 3D"}
                    </Button>
                    {preview && (
                      <div className="relative h-[480px] overflow-hidden rounded-2xl bg-accent-soft">
                        <DishViewer
                          key={glb.id}
                          asset={previewAsset!}
                          attempt={attempt}
                          retry={() => setAttempt((n) => n + 1)}
                        />
                      </div>
                    )}
                    <Field
                      label="License / rights"
                      hint="If public attribution is required, include the credit in the dish description before publishing."
                      value={draft.review.license}
                      maxLength={1000}
                      onChange={(e) =>
                        patch({
                          review: { ...draft.review, license: e.target.value },
                        })
                      }
                    />
                    <TextArea
                      label="Source & provenance"
                      value={draft.review.provenance}
                      maxLength={2000}
                      onChange={(e) =>
                        patch({
                          review: { ...draft.review, provenance: e.target.value },
                        })
                      }
                    />
                    <TextArea
                      label="Measurement & review notes"
                      value={draft.review.measurement_notes}
                      maxLength={2000}
                      placeholder="Record the real dish dimensions and how the GLB (and optional iPhone model) were checked."
                      onChange={(e) =>
                        patch({
                          review: {
                            ...draft.review,
                            measurement_notes: e.target.value,
                          },
                        })
                      }
                    />
                    <Check
                      label="I have permission to show this model publicly as a clearly labelled 3D demonstration."
                      checked={demoRights}
                      disabled={busy || demo}
                      onChange={(e) => setDemoRights(e.target.checked)}
                    />
                    <div className="rounded-xl border border-line bg-background p-4 text-sm leading-6">
                      <p>
                        A demonstration shows a visible sample-model notice to
                        customers and always disables AR. It does not certify a
                        real dish or portion.
                      </p>
                      {dirty && (
                        <p className="mt-2 text-xs text-muted">
                          Save your dish changes before changing this
                          presentation.
                        </p>
                      )}
                      <Button
                        className="mt-3"
                        disabled={
                          busy ||
                          demo ||
                          dirty ||
                          (!product.model_demo_enabled && !demoRights)
                        }
                        onClick={() => void changeDemonstration()}
                      >
                        {busy
                          ? "Saving…"
                          : product.model_demo_enabled
                            ? "Disable 3D demonstration"
                            : "Enable 3D demonstration"}
                      </Button>
                    </div>
                    <Check
                      label="I have rights to these assets and have verified they match this dish at its real size, including the iPhone version if supplied."
                      checked={draft.model_verified && !!draft.review.confirmed}
                      onChange={(e) =>
                        patch({
                          model_verified: e.target.checked,
                          model_ar_enabled: e.target.checked
                            ? draft.model_ar_enabled
                            : false,
                          review: {
                            ...draft.review,
                            confirmed: e.target.checked,
                          },
                        })
                      }
                    />
                    <Check
                      label="Enable ‘View on my table’ on supported devices"
                      disabled={!draft.model_verified}
                      checked={draft.model_ar_enabled}
                      onChange={(e) =>
                        patch({ model_ar_enabled: e.target.checked })
                      }
                    />
                  </>
                )}
              </Section>
            </details>
          </>
        )}
      </div>
      <div className="sticky bottom-4 mt-8 flex max-w-4xl justify-end gap-3 rounded-2xl border border-line bg-background/95 p-3 shadow-sm">
        <Button
          onClick={() => {
            if (!dirty || window.confirm("Discard unsaved changes?")) onClose();
          }}
        >
          Cancel
        </Button>
        <Button primary disabled={demo || busy} onClick={() => void save()}>
          {busy ? "Saving…" : fresh ? "Save draft" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
function OptionPrice({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const [text, setText] = useState((value / 100).toFixed(2)),
    [error, setError] = useState("");
  return (
    <div>
      <Field
        label="Supplement"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(priceMinor(e.target.value));
            setError("");
          } catch {
            onChange(NaN);
            setError("Enter a valid price.");
          }
        }}
      />
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
