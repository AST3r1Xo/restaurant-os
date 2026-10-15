"use client";
import { useState } from "react";
import { Button, Field, TextArea, Check, Section } from "./controls";
import { MediaField } from "./media-field";
import { savePresentationAction } from "./actions";
import type { MenuWorkspace } from "./types";
export function RestaurantSettings({
  initial,
  demo = false,
}: {
  initial: MenuWorkspace;
  demo?: boolean;
}) {
  const [workspace, setWorkspace] = useState(initial),
    [r, setR] = useState(initial.restaurant),
    [legacy, setLegacy] = useState({ logo: true, cover: true }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function save() {
    setMessage("");
    if (
      (r.is_published !== workspace.restaurant.is_published ||
        r.is_accepting_orders !== workspace.restaurant.is_accepting_orders) &&
      !window.confirm("Apply these restaurant visibility and ordering changes?")
    )
      return;
    setBusy(true);
    const result = await savePresentationAction(
      r.id,
      workspace.restaurant.updated_at,
      {
        name: r.name,
        description: r.description,
        timezone: r.timezone,
        is_published: r.is_published,
        is_accepting_orders: r.is_accepting_orders,
        logo_asset_id: r.logo_asset_id,
        cover_asset_id: r.cover_asset_id,
        keep_legacy_logo: legacy.logo,
        keep_legacy_cover: legacy.cover,
      },
    );
    if (result.ok) {
      setWorkspace(result.data);
      setR(result.data.restaurant);
      setMessage("Restaurant settings saved.");
    } else setMessage(result.message);
    setBusy(false);
  }
  const props = {
    restaurantId: r.id,
    assets: workspace.assets,
    disabled: demo || busy,
    onAsset: (a: MenuWorkspace["assets"][number]) =>
      setWorkspace((w) => ({
        ...w,
        assets: [a, ...w.assets.filter((x) => x.id !== a.id)],
      })),
  };
  return (
    <div className="max-w-4xl">
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-accent">
        The first impression
      </p>
      <h1 className="mt-3 font-display text-4xl">Your restaurant.</h1>
      <p className="mt-3 text-sm text-muted">
        Presentation and service preferences for {r.name}.
      </p>
      {demo && (
        <p className="mt-5 rounded-xl bg-accent-soft p-4 text-sm">
          Demo preview · saving and uploads are disabled.
        </p>
      )}
      {message && (
        <p
          role="status"
          className="mt-5 rounded-xl border border-line bg-white p-4 text-sm"
        >
          {message}
        </p>
      )}
      <div className="mt-8 space-y-6">
        <Section title="Restaurant details">
          <Field
            label="Display name"
            value={r.name}
            maxLength={120}
            onChange={(e) => setR({ ...r, name: e.target.value })}
          />
          <TextArea
            label="Description"
            rows={4}
            value={r.description}
            maxLength={4000}
            onChange={(e) => setR({ ...r, description: e.target.value })}
          />
          <Field
            label="Time zone"
            value={r.timezone}
            hint="For example: Europe/Lisbon. Used for restaurant operating dates."
            onChange={(e) => setR({ ...r, timezone: e.target.value })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Menu address" value={`/r/${r.slug}`} readOnly />
            <Field label="Menu currency" value={r.currency} readOnly />
          </div>
        </Section>
        <Section
          title="Branding"
          description="Public presentation assets only. Do not upload private documents."
        >
          <MediaField
            {...props}
            kind="logo"
            label="Restaurant logo"
            value={r.logo_asset_id}
            legacyUrl={legacy.logo ? r.logo_url : null}
            onChange={(id) => {
              setR({ ...r, logo_asset_id: id });
              setLegacy({ ...legacy, logo: false });
            }}
          />
          <MediaField
            {...props}
            kind="cover"
            label="Cover photograph"
            value={r.cover_asset_id}
            legacyUrl={legacy.cover ? r.cover_image_url : null}
            onChange={(id) => {
              setR({ ...r, cover_asset_id: id });
              setLegacy({ ...legacy, cover: false });
            }}
          />
        </Section>
        <Section title="Menu & ordering">
          <Check
            label="Publish restaurant menu"
            checked={r.is_published}
            onChange={(e) => setR({ ...r, is_published: e.target.checked })}
          />
          <Check
            label="Accept new customer orders"
            checked={r.is_accepting_orders}
            onChange={(e) =>
              setR({ ...r, is_accepting_orders: e.target.checked })
            }
          />
          <p className="text-xs leading-6 text-muted">
            Pausing orders preserves the menu and existing kitchen orders.
            Unpublishing hides the public menu. These controls do not change
            existing orders or table visits.
          </p>
        </Section>
        <div className="flex justify-end">
          <Button primary disabled={demo || busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save restaurant settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}
