"use client";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
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
    try {
      const result = await savePresentationAction(
        r.id,
        workspace.restaurant.updated_at,
        {
          name: r.name,
          description: r.description,
          timezone: r.timezone,
          opening_hours: r.opening_hours,
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
        router.refresh();
      } else setMessage(result.message);
    } catch {
      setMessage("Your changes could not be confirmed. Reload this page to check before trying again.");
    } finally {
      setBusy(false);
    }
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
      <h1 className="font-display text-4xl">Restaurant settings</h1>
      <p className="mt-3 text-sm text-muted">
        Update your restaurant’s name, opening hours and photos.
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
          <TextArea
            label="Opening hours"
            rows={4}
            maxLength={1000}
            placeholder="For example: Tuesday - Sunday, 12:00-15:00 & 19:00-23:00"
            value={r.opening_hours}
            onChange={(e) => setR({ ...r, opening_hours: e.target.value })}
          />
          <p className="text-xs leading-6 text-muted">
            Displayed on your closed screen. Hours are informational; use the
            OPEN / CLOSED control to manage service manually.
          </p>
          <details className="disclosure border-t border-line pt-2">
            <summary className="text-sm font-medium">Region & menu address</summary>
            <Field label="Time zone" value={r.timezone} hint="For example: Europe/Lisbon. Used for order dates." onChange={(e) => setR({ ...r, timezone: e.target.value })} />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Menu address" value={`/r/${r.slug}`} readOnly />
              <Field label="Menu currency" value={r.currency} readOnly />
            </div>
          </details>
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
              setR((current) => ({ ...current, logo_asset_id: id }));
              setLegacy((current) => ({ ...current, logo: false }));
            }}
          />
          <MediaField
            {...props}
            kind="cover"
            label="Cover photograph"
            value={r.cover_asset_id}
            legacyUrl={legacy.cover ? r.cover_image_url : null}
            onChange={(id) => {
              setR((current) => ({ ...current, cover_asset_id: id }));
              setLegacy((current) => ({ ...current, cover: false }));
            }}
          />
        </Section>
        <Section title="Menu visibility">
          <Check
            label="Show the menu to customers"
            checked={r.is_published}
            onChange={(e) => setR({ ...r, is_published: e.target.checked })}
          />
          <p className="text-xs leading-6 text-muted">
            Turn this off to hide the menu completely. To pause new orders,
            use Close restaurant at the top of the page instead.
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
