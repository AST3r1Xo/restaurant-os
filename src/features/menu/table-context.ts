import type { TableContext } from "./types";
import { DEMO_TABLES } from "@/lib/routes";
export { normalizeTableToken } from "@/lib/routes";

export function demoTableContext(token: string | null): TableContext {
  if (token === null) return { status: "missing" };
  const table = DEMO_TABLES.find((t) => t.token === token);
  return table
    ? { status: "valid", label: table.label, token, visitKey: "demo" }
    : { status: "invalid" };
}
