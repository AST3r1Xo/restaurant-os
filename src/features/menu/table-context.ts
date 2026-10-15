import type { TableContext } from "./types";
import { DEMO_TABLE_TOKEN } from "@/lib/routes";
export { normalizeTableToken } from "@/lib/routes";

export function demoTableContext(token: string | null): TableContext {
  if (token === null) return { status: "missing" };
  return token === DEMO_TABLE_TOKEN
    ? { status: "valid", label: "Table 04", token, visitKey: "demo" }
    : { status: "invalid" };
}
