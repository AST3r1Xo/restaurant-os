import { redirect, unstable_rethrow } from "next/navigation";
import { getDataMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { verifiedStaff, staffMemberships } from "@/features/staff/auth";
import { StaffLogin } from "@/features/staff/components/staff-login";
export const metadata = {
  title: "Staff sign in",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  if (getDataMode() === "demo") redirect("/admin");
  let hasSession = false;
  try {
    const client = await createClient();
    const user = await verifiedStaff(client);
    hasSession = true;
    if ((await staffMemberships(client, user.id)).length)
      redirect("/admin/orders");
  } catch (error) {
    unstable_rethrow(error);
  }
  const { reason } = await searchParams;
  return (
    <StaffLogin
      hasSession={hasSession}
      message={
        hasSession || reason === "membership"
          ? "This account needs a restaurant membership. Ask your owner to assign access through trusted administration."
          : reason === "session"
            ? "Sign in to access your restaurant workspace."
            : undefined
      }
    />
  );
}
