import { redirect } from "next/navigation";
import { getDataMode } from "@/lib/env";
import { DEMO_MENU_URL } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default function HomePage() {
  redirect(getDataMode() === "demo" ? DEMO_MENU_URL : "/r/mesa");
}
