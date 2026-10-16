// Development harnesses must receive separate, explicit administrative authority.
// Never borrow the application media-only credential for fixture provisioning.
export function qaAdminKey(url, env = process.env) {
  if (!env.PILOT_QA_ADMIN_KEY)
    throw new Error(
      "QA provisioning needs a separately authorized PILOT_QA_ADMIN_KEY; never reuse the media-only application key.",
    );
  if (
    !/^[a-z0-9]{20}$/.test(env.PILOT_QA_PROJECT_REF ?? "") ||
    new URL(url).hostname !== `${env.PILOT_QA_PROJECT_REF}.supabase.co`
  )
    throw new Error(
      "Set PILOT_QA_PROJECT_REF to the intended development project.",
    );
  return env.PILOT_QA_ADMIN_KEY;
}
