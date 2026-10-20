import {
  cartLineKey,
  MAX_LINES,
  MAX_QUANTITY,
  subtractPurchasedItems,
} from "./model.ts";
import type { CartIntent } from "./model.ts";
import { specialRequestFields, validSpecialRequest } from "./special-request.ts";
export type CartScope = {
  restaurantId: string;
  mode: "demo" | "live";
  currency: string;
  visitKey?: string;
};
export type CartSnapshot = {
  items: CartIntent[];
  ready: boolean;
  storageError: boolean;
};
export type StorageAdapter = Pick<Storage, "getItem" | "setItem">;
const empty: CartSnapshot = { items: [], ready: false, storageError: false };
export function cartStorageKey(scope: CartScope) {
  return `restaurant-os:cart:v2:${scope.mode}:${encodeURIComponent(scope.restaurantId)}:${encodeURIComponent(scope.visitKey ?? "unbound")}`;
}
export function purgeOtherVisitStorage(
  storage: Pick<Storage, "length" | "key" | "removeItem">,
  scope: CartScope,
) {
  const restaurant = encodeURIComponent(scope.restaurantId);
  const current = [
    cartStorageKey(scope),
    `restaurant-os:submission:v2:${scope.mode}:${restaurant}:${encodeURIComponent(scope.visitKey ?? "unbound")}`,
  ];
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (
      key &&
      !current.includes(key) &&
      ["cart", "submission"].some(
        (kind) =>
          key === `restaurant-os:${kind}:v1:${scope.mode}:${restaurant}` ||
          key.startsWith(
            `restaurant-os:${kind}:v2:${scope.mode}:${restaurant}:`,
          ),
      )
    )
      storage.removeItem(key);
  }
}
export function serializeCart(
  scope: CartScope,
  items: CartIntent[],
  confirmedOrders: string[] = [],
) {
  return JSON.stringify({ version: 2, ...scope, items, confirmedOrders });
}
function parseConfirmedOrders(raw: string | null, scope: CartScope): string[] {
  if (!raw || raw.length > 200000) return [];
  try {
    const data = JSON.parse(raw);
    return data.version === 2 &&
      data.visitKey === scope.visitKey &&
      data.restaurantId === scope.restaurantId &&
      data.mode === scope.mode &&
      data.currency === scope.currency &&
      Array.isArray(data.confirmedOrders) &&
      data.confirmedOrders.length <= 100 &&
      data.confirmedOrders.every(
        (id: unknown) => typeof id === "string" && id.length <= 160,
      )
      ? data.confirmedOrders
      : [];
  } catch {
    return [];
  }
}
export function parseCart(raw: string | null, scope: CartScope): CartIntent[] {
  if (!raw || raw.length > 200000) return [];
  try {
    const data = JSON.parse(raw);
    if (
      data.version !== 2 ||
      data.visitKey !== scope.visitKey ||
      data.restaurantId !== scope.restaurantId ||
      data.mode !== scope.mode ||
      data.currency !== scope.currency ||
      !Array.isArray(data.items) ||
      data.items.length > MAX_LINES
    )
      return [];
    const seen = new Set<string>();
    const items: CartIntent[] = [];
    for (const line of data.items) {
      if (
        !line ||
        typeof line.productId !== "string" ||
        !line.productId.length ||
        line.productId.length > 160 ||
        !Number.isInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > MAX_QUANTITY ||
        !Array.isArray(line.optionIds) ||
        line.optionIds.length > 100 ||
        line.optionIds.some(
          (id: unknown) => typeof id !== "string" || id.length > 160,
        ) ||
        new Set(line.optionIds).size !== line.optionIds.length ||
        (line.notes !== undefined && !validSpecialRequest(line.notes))
      )
        return [];
      const item = {
        productId: line.productId,
        quantity: line.quantity,
        optionIds: [...line.optionIds].sort(),
        ...specialRequestFields(line.notes),
      };
      const key = cartLineKey(item);
      if (seen.has(key)) return [];
      seen.add(key);
      items.push(item);
    }
    return items;
  } catch {
    return [];
  }
}
export function createCartStore(
  scope: CartScope,
  getStorage: () => StorageAdapter,
) {
  let snapshot = empty;
  let confirmedOrders: string[] = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  function load() {
    try {
      const raw = getStorage().getItem(cartStorageKey(scope));
      confirmedOrders = parseConfirmedOrders(raw, scope);
      snapshot = {
        items: parseCart(raw, scope),
        ready: true,
        storageError: false,
      };
    } catch {
      snapshot = { ...snapshot, ready: true, storageError: true };
    }
    emit();
  }
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => empty,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!snapshot.ready) load();
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    update(change: (items: CartIntent[]) => CartIntent[]) {
      if (!snapshot.ready) load();
      let current = snapshot.items;
      try {
        const raw = getStorage().getItem(cartStorageKey(scope));
        if (raw !== null) {
          current = parseCart(raw, scope);
          confirmedOrders = parseConfirmedOrders(raw, scope);
        }
      } catch {
        // Blocked storage still permits an in-memory bag.
      }
      const items = change(current);
      let storageError = false;
      try {
        getStorage().setItem(
          cartStorageKey(scope),
          serializeCart(scope, items, confirmedOrders),
        );
      } catch {
        storageError = true;
      }
      snapshot = { items, ready: true, storageError };
      emit();
    },
    clearPurchased(orderId: string, purchased: CartIntent[]) {
      if (!snapshot.ready) load();
      let current = snapshot.items;
      try {
        const raw = getStorage().getItem(cartStorageKey(scope));
        if (raw !== null) {
          current = parseCart(raw, scope);
          confirmedOrders = parseConfirmedOrders(raw, scope);
        }
      } catch {
        // Preserve the current in-memory bag if storage is unavailable.
      }
      if (confirmedOrders.includes(orderId)) return;
      const items = subtractPurchasedItems(current, purchased);
      confirmedOrders = [...confirmedOrders, orderId].slice(-100);
      let storageError = false;
      try {
        // The cleanup receipt and resulting bag share one storage write, so a
        // refresh cannot subtract a successfully purchased quantity twice.
        getStorage().setItem(
          cartStorageKey(scope),
          serializeCart(scope, items, confirmedOrders),
        );
      } catch {
        storageError = true;
      }
      snapshot = { items, ready: true, storageError };
      emit();
    },
  };
}
