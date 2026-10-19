"use client";
import { useEffect, useRef, useState } from "react";
import {
  Box,
  LoaderCircle,
  Minus,
  Plus,
  RotateCcw,
  Smartphone,
} from "lucide-react";
import type { ModelViewerElement } from "@google/model-viewer";
import type { ProductVisualization } from "../assets";
import { previewSource } from "../assets";
import { supportsBrowserAR } from "../browser-support";
import type { BrowserXR } from "../browser-support";
import {
  connectViewer,
  initialViewerState,
  tablePlacementGuide,
} from "../viewer-controller";
import type { ViewerState } from "../viewer-controller";

export function DishViewer({
  asset,
  retry,
  attempt,
}: {
  asset: ProductVisualization;
  retry: () => void;
  attempt: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof connectViewer>>(undefined);
  const [state, setState] = useState<ViewerState>(initialViewerState);
  const [cameraMode, setCameraMode] = useState<"guided" | "device">("guided");
  const [browserCamera, setBrowserCamera] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let element: ModelViewerElement | undefined;
    const container = host.current;
    Promise.all([
      import("@google/model-viewer"),
      asset.arEnabled !== false && !asset.demonstration
        ? supportsBrowserAR(
            location.protocol === "https:",
            (navigator as Navigator & { xr?: BrowserXR }).xr,
          )
        : Promise.resolve(false),
    ])
      .then(([{ ModelViewerElement: Viewer }, supported]) => {
        if (cancelled || !container) return;
        setBrowserCamera(supported);
        Viewer.modelCacheSize = 0;
        element = document.createElement("model-viewer") as ModelViewerElement;
        element.className = "dish-model";
        element.setAttribute(
          "interpolation-decay",
          matchMedia("(prefers-reduced-motion: reduce)").matches ? "0" : "50",
        );
        const nativeButton = document.createElement("span");
        nativeButton.slot = "ar-button";
        nativeButton.hidden = true;
        element.append(nativeButton);
        // Only WebXR uses this DOM overlay. Quick Look and Scene Viewer
        // provide their own camera, surface guide and exit controls.
        const guide = document.createElement("div");
        guide.className = "dish-ar-guide";
        guide.setAttribute("role", "status");
        guide.setAttribute("aria-live", "polite");
        const target = document.createElement("span");
        target.className = "dish-ar-target";
        target.setAttribute("aria-hidden", "true");
        const card = document.createElement("div");
        card.className = "dish-ar-card";
        const title = document.createElement("strong");
        const instruction = document.createElement("p");
        card.append(title, instruction);
        guide.append(target, card);
        const exit = document.createElement("button");
        exit.type = "button";
        exit.slot = "exit-webxr-ar-button";
        exit.className = "dish-ar-back";
        exit.textContent = "Back";
        exit.setAttribute("aria-label", "Exit table preview and return to the dish");
        element.append(guide, exit);
        controller.current = connectViewer(
          element,
          { ...asset, src: previewSource(asset.src, attempt) },
          location.protocol === "https:",
          (next) => {
            const copy = tablePlacementGuide(next);
            title.textContent = copy.title;
            instruction.textContent = copy.instruction;
            guide.dataset.trackingLost = String(next.trackingLost);
            setState(next);
          },
          { browserAR: supported && cameraMode === "guided" },
        );
        container.append(element);
      })
      .catch(() => {
        if (!cancelled) setState({ ...initialViewerState, phase: "error" });
      });
    return () => {
      cancelled = true;
      controller.current?.dispose();
      controller.current = undefined;
      element?.remove();
    };
  }, [asset, attempt, cameraMode]);
  const arMessage =
    state.ar === "disabled"
      ? "Table placement is disabled for this model. Interactive 3D remains available."
      : state.ar === "https"
        ? "Table placement needs an HTTPS menu on a supported phone. Interactive 3D works here."
        : state.ar === "scale"
          ? "Table placement is unavailable until this model’s physical size is verified. You can explore it in 3D."
          : state.ar === "unsupported"
            ? "AR isn’t available on this device or browser. Enjoy interactive 3D, or open this menu in Safari on iPhone or Chrome on a compatible Android phone."
            : "Checking table placement support…";
  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-[#efeee5]"
      aria-label="Interactive dish preview"
    >
      <div className="relative min-h-40 flex-1">
        <div
          ref={host}
          className={state.phase === "error" ? "hidden" : "absolute inset-0"}
        />
        {state.phase === "loading" && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-[#efeee5]/90 px-8 text-center"
          >
            <LoaderCircle
              size={24}
              className="animate-spin motion-reduce:animate-none text-accent"
              aria-hidden="true"
            />
            <p className="mt-4 font-display text-2xl">A closer look.</p>
            <p className="mt-2 text-xs leading-6 text-muted">
              {state.slow
                ? "Taking a little longer. You can return to the photo and keep ordering."
                : "Preparing your interactive preview…"}
            </p>
            <progress
              className="mt-5 h-1 w-32 accent-accent"
              max={1}
              value={state.progress}
              aria-label="3D model loading progress"
            />
          </div>
        )}
        {state.phase === "error" && (
          <div
            role="alert"
            className="flex h-full min-h-64 flex-col items-center justify-center px-7 py-8 text-center"
          >
            <Box
              size={30}
              strokeWidth={1.2}
              className="text-accent"
              aria-hidden="true"
            />
            <h3 className="mt-4 font-display text-2xl">
              The preview couldn’t load.
            </h3>
            <p className="mt-3 max-w-xs text-xs leading-6 text-muted">
              Check your connection and try again. Your customizations and bag
              are safe; you can keep ordering from the photo.
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-5 min-h-11 rounded-full border border-accent/25 bg-white/70 px-6 text-sm text-accent"
            >
              Retry 3D preview
            </button>
          </div>
        )}
        {state.phase === "ready" && (
          <div
            role="group"
            aria-label="3D camera controls"
            className="absolute right-3 top-3 flex items-center rounded-full border border-line bg-background/95 text-accent"
          >
            <button
              type="button"
              aria-label="Zoom out of 3D model"
              onClick={() => controller.current?.zoom(-1)}
              className="flex size-11 items-center justify-center"
            >
              <Minus size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => controller.current?.reset()}
              className="inline-flex min-h-11 items-center gap-2 px-3 text-xs text-accent"
              aria-label="Reset 3D camera view"
            >
              <RotateCcw size={14} aria-hidden="true" />
              Centre dish
            </button>
            <button
              type="button"
              aria-label="Zoom into 3D model"
              onClick={() => controller.current?.zoom(1)}
              className="flex size-11 items-center justify-center"
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {state.phase === "ready" && (
        <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-accent/10 bg-background/80 px-5 py-3">
          <p className="text-center text-[11px] text-muted">
            Drag to rotate · Pinch or scroll to zoom
            <span className="sr-only">
              . Keyboard: arrow keys rotate, Page Up and Page Down zoom. Zoom
              buttons are also available.
            </span>
          </p>
          {state.ar === "available" ? (
            <>
              <button
                type="button"
                disabled={state.launching}
                onClick={() => controller.current?.launchAR()}
                className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-medium text-white disabled:opacity-60"
              >
                <Smartphone size={17} aria-hidden="true" />
                {state.launching ? "Opening AR…" : "View on my table"}
              </button>
              <p className="mt-2 text-center text-[11px] leading-5 text-muted">
                {browserCamera && cameraMode === "guided"
                  ? "Allow camera access, then slowly scan your tabletop. Drag the dish to position it."
                  : "In your phone’s viewer, choose AR if needed. Slowly scan a well-lit tabletop to place the dish."}
              </p>
            </>
          ) : (
            <p
              role="status"
              className="mt-3 text-center text-[11px] leading-5 text-muted"
            >
              {arMessage}
            </p>
          )}
          {(state.ar === "available" ||
            (state.ar === "unsupported" && browserCamera)) && (
            <details className="disclosure mt-2 text-xs text-muted">
              <summary>Camera not showing the dish?</summary>
              <div className="pb-2 leading-6">
                <p>
                  Try a patterned placemat in good light. A plain or shiny
                  table can be difficult for the camera to detect.
                </p>
                {browserCamera && (
                  <button
                    type="button"
                    onClick={() => {
                      setState(initialViewerState);
                      setCameraMode(
                        cameraMode === "guided" ? "device" : "guided",
                      );
                    }}
                    className="mt-3 min-h-11 w-full rounded-full border border-accent/25 bg-white px-4 font-medium text-accent"
                  >
                    {cameraMode === "guided"
                      ? "Try phone’s AR viewer instead"
                      : "Try guided browser camera instead"}
                  </button>
                )}
                <p className="mt-2">
                  On Android, update Chrome and{" "}
                  <a
                    href="https://play.google.com/store/apps/details?id=com.google.ar.core"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block min-h-11 content-center underline underline-offset-2"
                  >
                    Google Play Services for AR
                  </a>
                  . If tracking still fails, use interactive 3D. You can always
                  return to the dish and order normally.
                </p>
              </div>
            </details>
          )}
          {state.guidance && (
            <p
              role="status"
              className="mt-3 rounded-xl bg-accent-soft p-3 text-xs leading-6 text-accent"
            >
              {state.guidance}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
