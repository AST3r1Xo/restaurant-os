import { arAvailability, dimensionsMatch } from "./assets.ts";
import type { ProductVisualization } from "./assets.ts";

export type ViewerState = {
  phase: "loading" | "ready" | "error";
  progress: number;
  slow: boolean;
  ar: "checking" | ReturnType<typeof arAvailability>;
  guidance?: string;
  launching: boolean;
};
export const initialViewerState: ViewerState = {
  phase: "loading",
  progress: 0,
  slow: false,
  ar: "checking",
  launching: false,
};
// Public APIs only. Tests exercise events, failures and cleanup without WebGL.
export interface ViewerPort extends EventTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  canActivateAR: boolean;
  loaded: boolean;
  getDimensions(): { x: number; y: number; z: number };
  activateAR(): Promise<void>;
  pause(): void;
  resetTurntableRotation(): void;
  jumpCameraToGoal(): void;
  zoom(steps: number): void;
}
export function connectViewer(
  viewer: ViewerPort,
  asset: ProductVisualization,
  https: boolean,
  change: (state: ViewerState) => void,
) {
  let stopped = false,
    scaleMatches = false,
    checks = 0;
  let capabilities: ReturnType<typeof setInterval> | undefined;
  let state = { ...initialViewerState };
  const arEnabled = asset.demonstration !== true && asset.arEnabled !== false;
  const emit = (patch: Partial<ViewerState>) => {
    if (stopped) return;
    state = { ...state, ...patch };
    change(state);
  };
  const fail = () => {
    viewer.removeAttribute("ar");
    viewer.pause();
    viewer.removeAttribute("src");
    clearInterval(capabilities);
    emit({
      phase: "error",
      guidance:
        "The preview couldn’t load. Your selection is safe; retry or return to the photo.",
    });
  };
  const capability = () => {
    if (state.phase !== "ready") return;
    const available = arAvailability(
      https,
      viewer.canActivateAR,
      scaleMatches,
      arEnabled,
    );
    emit({
      ar: available === "unsupported" && checks < 10 ? "checking" : available,
    });
  };
  const load = () => {
    if (state.phase === "error") return;
    try {
      scaleMatches = dimensionsMatch(asset.dimensions, viewer.getDimensions());
      if (https && scaleMatches && arEnabled) viewer.setAttribute("ar", "");
      emit({ phase: "ready", progress: 1, slow: false });
      capability();
      clearInterval(capabilities);
      capabilities = setInterval(() => {
        checks++;
        capability();
        if (checks >= 20 || state.ar === "available")
          clearInterval(capabilities);
      }, 500);
    } catch {
      fail();
    }
  };
  const progress = (event: Event) => {
    const total = (event as CustomEvent<{ totalProgress: number }>).detail
      ?.totalProgress;
    if (typeof total === "number" && Number.isFinite(total))
      emit({
        progress: Math.max(state.progress, Math.min(1, Math.max(0, total))),
      });
  };
  const arStatus = (event: Event) => {
    const status = (event as CustomEvent<{ status: string }>).detail?.status;
    if (status === "failed")
      emit({
        guidance:
          "AR couldn’t start. Try again in Safari on iPhone or Chrome on a compatible Android phone. You can keep exploring in 3D.",
      });
    else if (status === "session-started")
      emit({
        guidance:
          "Move your phone slowly and point at a flat table. Follow the placement guide.",
      });
    else if (status === "object-placed")
      emit({
        guidance:
          "Your preview is placed. Move around to explore; use the viewer’s exit control to return.",
      });
    else if (status === "not-presenting")
      emit({ guidance: undefined, launching: false });
  };
  viewer.addEventListener("load", load);
  viewer.addEventListener("error", fail);
  viewer.addEventListener("progress", progress);
  viewer.addEventListener("ar-status", arStatus);
  const attributes: Record<string, string | undefined> = {
    alt: asset.alt,
    "aria-label": asset.alt,
    "camera-controls": "",
    "touch-action": "pan-y",
    "ar-modes": "webxr scene-viewer quick-look",
    "ar-scale": "fixed",
    "ar-placement": "floor",
    "xr-environment": "",
    "shadow-intensity": "0.8",
    "shadow-softness": "0.9",
    exposure: "1",
    "environment-image": "neutral",
    "camera-orbit": "30deg 55deg 115%",
    "min-camera-orbit": "auto 10deg 55%",
    "max-camera-orbit": "auto 100deg 200%",
    "interaction-prompt": "none",
    loading: "eager",
    reveal: "auto",
    "ios-src": asset.iosSrc,
    poster: asset.poster,
    src: asset.src,
  };
  for (const [name, value] of Object.entries(attributes))
    if (value !== undefined) viewer.setAttribute(name, value);
  const slow = setTimeout(() => {
    if (state.phase === "loading") emit({ slow: true });
  }, 12000);
  const timeout = setTimeout(() => {
    if (state.phase === "loading") fail();
  }, 45000);
  if (viewer.loaded) load();
  return {
    zoom(steps: number) {
      if (!stopped && state.phase === "ready") viewer.zoom(steps);
    },
    reset() {
      if (state.phase !== "ready") return;
      viewer.resetTurntableRotation();
      viewer.setAttribute("camera-orbit", "30deg 55deg 115%");
      viewer.jumpCameraToGoal();
    },
    launchAR() {
      if (
        stopped ||
        state.launching ||
        state.phase !== "ready" ||
        state.ar !== "available"
      )
        return;
      emit({
        launching: true,
        guidance:
          "Follow your phone’s AR placement guide. Your dish selections stay here when you return.",
      });
      // Native launch must remain synchronous with the customer's click.
      try {
        void viewer
          .activateAR()
          .catch(() => {
            emit({
              guidance:
                "AR couldn’t start. Please try again; interactive 3D and ordering are still available.",
            });
          })
          .finally(() => emit({ launching: false }));
      } catch {
        emit({
          launching: false,
          guidance:
            "AR couldn’t start. Please try again or return to the photo.",
        });
      }
    },
    dispose() {
      stopped = true;
      clearTimeout(slow);
      clearTimeout(timeout);
      clearInterval(capabilities);
      viewer.removeEventListener("load", load);
      viewer.removeEventListener("error", fail);
      viewer.removeEventListener("progress", progress);
      viewer.removeEventListener("ar-status", arStatus);
      viewer.pause();
      viewer.removeAttribute("ar");
      viewer.removeAttribute("src");
      viewer.removeAttribute("ios-src");
      viewer.removeAttribute("poster");
    },
  };
}
