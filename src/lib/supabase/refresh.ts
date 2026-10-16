// Proxy refresh is a cookie maintenance step, never an authorization decision.
// A temporary Auth outage must reach the route's normal recovery boundary.
// Protected reads/actions still remotely verify identity and membership.
export async function refreshForRouting(refresh: () => Promise<unknown>) {
  try {
    await refresh();
  } catch {
    /* Do not log tokens or raw Auth errors. */
  }
}
