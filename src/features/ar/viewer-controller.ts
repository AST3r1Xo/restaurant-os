import { arAvailability, dimensionsMatch } from "./assets.ts";
import type { ProductVisualization } from "./assets.ts";

export type ViewerState = {
  phase: "loading" | "ready" | "error";
  progress: number;
  slow: boolean;
  ar: "checking" | ReturnType<typeof arAvailability>;
  guidance?: string;
  launching: boolean;
  placement: "idle" | "searching" | "placed";
  trackingLost: boolean;
};
export const initialViewerState: ViewerState = {
  phase: "loading",
  progress: 0,
  slow: false,
  ar: "checking",
  launching: false,
  placement: "idle",
  trackingLost: false,
};

const CAMERA_ORBIT = "30deg 50deg 105%";

export function tablePlacementGuide(
  state: Pick<ViewerState, "placement" | "trackingLost">,
) {
  if (state.trackingLost)
    return {
      title: "Point back at the table",
      instruction:
        "Move slowly in good light so your phone can find the surface again.",
    };
  if (state.placement === "placed")
    return {
      title: "Your dish is on the table",
      instruction: "Move closer to take a look. The dish stays where you placed it.",
    };
  return {
    title: "Find your table",
    instruction:
      "Point at the tabletop and move your phone slowly until the dish is placed.",
  };
}
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
      launching: false,
      placement: "idle",
      trackingLost: false,
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
        launching: false,
        placement: "idle",
        trackingLost: false,
        guidance:
          "AR couldn’t start. Try again in Safari on iPhone or Chrome on a compatible Android phone. You can keep exploring in 3D.",
      });
    else if (status === "session-started")
      emit({
        placement: "searching",
        trackingLost: false,
        guidance:
          "Move your phone slowly and point at a flat table. Follow the placement guide.",
      });
    else if (status === "object-placed")
      emit({
        placement: "placed",
        guidance: tablePlacementGuide({ ...state, placement: "placed" }).instruction,
      });
    else if (status === "not-presenting")
      emit({
        guidance: undefined,
        launching: false,
        placement: "idle",
        trackingLost: false,
      });
  };
  const arTracking = (event: Event) => {
    if (state.placement === "idle") return;
    const status = (event as CustomEvent<{ status: string }>).detail?.status;
    if (status !== "tracking" && status !== "not-tracking") return;
    const trackingLost = status === "not-tracking";
    emit({
      trackingLost,
      guidance: tablePlacementGuide({ ...state, trackingLost }).instruction,
    });
  };
  const resetCamera = () => {
    viewer.resetTurntableRotation();
    viewer.setAttribute("camera-target", "auto auto auto");
    viewer.setAttribute("camera-orbit", CAMERA_ORBIT);
    viewer.setAttribute("field-of-view", "auto");
    viewer.jumpCameraToGoal();
  };
  viewer.addEventListener("load", load);
  viewer.addEventListener("error", fail);
  viewer.addEventListener("progress", progress);
  viewer.addEventListener("ar-status", arStatus);
  viewer.addEventListener("ar-tracking", arTracking);
  const attributes: Record<string, string | undefined> = {
    alt: asset.alt,
    "aria-label": asset.alt,
    "camera-controls": "",
    // Keep touch rotation/zoom, but do not let a two-finger drag or a tap
    // move the orbit centre away from a small, flat dish.
    "disable-pan": "",
    "disable-tap": "",
    "touch-action": "pan-y",
    // Use the phone's native surface-placement UI where available. WebXR
    // remains a fallback, with our in-session surface/tracking guidance.
    "ar-modes": "scene-viewer quick-look webxr",
    "ar-scale": "fixed",
    "ar-placement": "floor",
    "xr-environment": "",
    "shadow-intensity": "0.8",
    "shadow-softness": "0.9",
    exposure: "1",
    "environment-image": "neutral",
    "camera-target": "auto auto auto",
    "camera-orbit": CAMERA_ORBIT,
    "min-camera-orbit": "auto 15deg 85%",
    "max-camera-orbit": "auto 85deg 180%",
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
      if (stopped || state.phase !== "ready" || state.placement !== "idle")
        return;
      resetCamera();
    },
    launchAR() {
      if (
        stopped ||
        state.launching ||
        state.placement !== "idle" ||
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
        resetCamera();
        void viewer
          .activateAR()
          .catch(() => {
            emit({
              placement: "idle",
              trackingLost: false,
              guidance:
                "AR couldn’t start. Please try again; interactive 3D and ordering are still available.",
            });
          })
          .finally(() => emit({ launching: false }));
      } catch {
        emit({
          launching: false,
          placement: "idle",
          trackingLost: false,
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
      viewer.removeEventListener("ar-tracking", arTracking);
      viewer.pause();
      viewer.removeAttribute("ar");
      viewer.removeAttribute("src");
      viewer.removeAttribute("ios-src");
      viewer.removeAttribute("poster");
    },
  };
}
