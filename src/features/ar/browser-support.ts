// Probe only after opening a preview. Camera permission is requested by the
// viewer on the customer's click, never by this capability check.
export type BrowserXR = {
  isSessionSupported: (mode: "immersive-ar") => Promise<boolean>;
};

export async function supportsBrowserAR(
  https: boolean,
  xr?: BrowserXR,
): Promise<boolean> {
  if (!https || !xr) return false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return (
      (await Promise.race([
        xr.isSessionSupported("immersive-ar"),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), 1500);
        }),
      ])) === true
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
