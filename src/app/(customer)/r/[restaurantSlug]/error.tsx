"use client";

import { useParams } from "next/navigation";
import { customerPath, normalizeTableToken } from "@/lib/routes";

export default function CustomerError({ retry }: { retry: () => void }) {
  const { restaurantSlug } = useParams<{ restaurantSlug: string }>();
  function menu() {
    if (typeof restaurantSlug !== "string" || !restaurantSlug) {
      window.location.reload();
      return;
    }
    const token = normalizeTableToken(
      new URL(window.location.href).searchParams.get("table") ?? undefined,
    );
    window.location.assign(
      customerPath(
        restaurantSlug,
        "menu",
        token && token !== "invalid" ? token : undefined,
      ),
    );
  }
  return (
    <main
      id="main-content"
      role="alert"
      className="mx-auto max-w-md px-6 py-20 text-center"
    >
      <h1 className="font-display text-4xl">A moment, please.</h1>
      <p className="mt-4 text-sm leading-7 text-muted">
        We couldn’t reach this restaurant’s menu. Reconnect and try again. Your
        saved bag stays on this device; nothing is submitted by retrying this
        page.
      </p>
      <button
        onClick={retry}
        className="mt-6 min-h-12 rounded-full bg-accent px-6 text-white"
      >
        Try again
      </button>
      <button
        onClick={menu}
        className="mx-auto mt-3 block min-h-11 text-sm text-accent underline"
      >
        Back to this restaurant’s menu
      </button>
    </main>
  );
}
