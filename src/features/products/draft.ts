import { productRevision } from "../cart/model.ts";
import type { CartScope, StorageAdapter } from "../cart/persistence.ts";
import type { MenuProduct } from "../menu/types.ts";
type Draft = {
  quantity: number;
  optionIds: string[];
  ready: boolean;
  storageError: boolean;
};
const empty: Draft = {
  quantity: 1,
  optionIds: [],
  ready: false,
  storageError: false,
};
export function draftKey(scope: CartScope, productId: string) {
  return `mesa:draft:v1:${scope.mode}:${scope.restaurantId}:${scope.visitKey ?? "unbound"}:${productId}`;
}
export function restoreDraft(
  raw: string | null,
  scope: CartScope,
  product: MenuProduct,
): Pick<Draft, "quantity" | "optionIds"> {
  const fallback = { quantity: 1, optionIds: [] };
  if (!raw || raw.length > 20000) return fallback;
  try {
    const d = JSON.parse(raw);
    if (
      d.version !== 1 ||
      d.visitKey !== scope.visitKey ||
      d.restaurantId !== scope.restaurantId ||
      d.mode !== scope.mode ||
      d.productId !== product.id ||
      d.revision !== productRevision(product) ||
      !Number.isInteger(d.quantity) ||
      d.quantity < 1 ||
      d.quantity > 99 ||
      !Array.isArray(d.optionIds) ||
      d.optionIds.length > 100 ||
      d.optionIds.some((id: unknown) => typeof id !== "string") ||
      new Set(d.optionIds).size !== d.optionIds.length
    )
      return fallback;
    const known = new Set(
      product.modifierGroups.flatMap((g) => g.options.map((o) => o.id)),
    );
    if (
      d.optionIds.some((id: string) => !known.has(id)) ||
      product.modifierGroups.some(
        (g) =>
          g.options.filter((o) => d.optionIds.includes(o.id)).length >
          g.maxSelections,
      )
    )
      return fallback;
    // In-progress drafts may still be missing required options. Addition and
    // trusted order creation retain their independent complete validation.
    return { quantity: d.quantity, optionIds: d.optionIds };
  } catch {
    return fallback;
  }
}
export function createDraftStore(
  scope: CartScope,
  product: MenuProduct,
  storage: () => StorageAdapter &
    Pick<Storage, "length" | "key" | "removeItem">,
) {
  let snapshot = empty;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((f) => f());
  const key = draftKey(scope, product.id);
  const save = (draft: Pick<Draft, "quantity" | "optionIds">) => {
    let storageError = false;
    try {
      storage().setItem(
        key,
        JSON.stringify({
          ...draft,
          version: 1,
          visitKey: scope.visitKey,
          mode: scope.mode,
          restaurantId: scope.restaurantId,
          productId: product.id,
          revision: productRevision(product),
        }),
      );
    } catch {
      storageError = true;
    }
    snapshot = { ...draft, ready: true, storageError };
    emit();
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => empty,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!snapshot.ready) {
        try {
          const s = storage();
          if (scope.mode === "demo" || scope.visitKey) {
            const prefix = `mesa:draft:v1:${scope.mode}:${scope.restaurantId}:`;
            const current = `${prefix}${scope.visitKey ?? "unbound"}:`;
            const remove: string[] = [];
            for (let i = 0; i < (s.length ?? 0); i++) {
              const k = s.key?.(i);
              if (k?.startsWith(prefix) && !k.startsWith(current))
                remove.push(k);
            }
            remove.forEach((k) => s.removeItem(k));
          }
          snapshot = {
            ...restoreDraft(s.getItem(key), scope, product),
            ready: true,
            storageError: false,
          };
        } catch {
          snapshot = { ...empty, ready: true, storageError: true };
        }
        emit();
      }
      return () => {
        listeners.delete(listener);
      };
    },
    setQuantity(quantity: number) {
      save({ quantity, optionIds: snapshot.optionIds });
    },
    setOptionIds(change: (ids: string[]) => string[]) {
      save({
        quantity: snapshot.quantity,
        optionIds: change(snapshot.optionIds),
      });
    },
  };
}
