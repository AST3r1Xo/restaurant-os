"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import type {
  CustomerContext,
  RestaurantMenu,
  MenuProduct,
} from "@/features/menu/types";
import {
  addCartItem,
  cartLineKey,
  cartTotals,
  productRevision,
  resolveCart,
  validateSelection,
  updateCartItemNotes,
} from "../model";
import type { CartIntent } from "../model";
import {
  cartStorageKey,
  createCartStore,
  purgeOtherVisitStorage,
} from "../persistence";
import { currentVisitKeyAction, validateCartAddition } from "../actions";
import { submissionStorageKey } from "@/features/orders/submission-persistence";
import { validSpecialRequest } from "../special-request";

function useCartState(menu: RestaurantMenu, context: CustomerContext) {
  const router = useRouter();
  const [notice, setNotice] = useState<string>();
  const [visitEnded, setVisitEnded] = useState(false);
  const visitKey =
    context.table.status === "valid" ? context.table.visitKey : undefined;
  const token =
    context.table.status === "valid" ? context.table.token : undefined;
  const [store] = useState(() =>
    createCartStore(
      {
        restaurantId: menu.id,
        mode: context.mode,
        currency: menu.currency,
        visitKey,
      },
      () => window.localStorage,
    ),
  );
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key ===
          cartStorageKey({
            restaurantId: menu.id,
            mode: context.mode,
            currency: menu.currency,
            visitKey,
          })
      )
        store.load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [store, menu.id, menu.currency, context.mode, visitKey]);
  useEffect(() => {
    const currentScope = {
      restaurantId: menu.id,
      mode: context.mode,
      currency: menu.currency,
      visitKey,
    };
    // A browse-only URL cannot decide which existing dining visit ended.
    if (context.mode === "live" && !visitKey) return;
    try {
      purgeOtherVisitStorage(window.localStorage, currentScope);
    } catch {
      /* Storage may be disabled. */
    }
    if (context.mode !== "live" || !token || !visitKey) return;
    let stopped = false,
      checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const latest = await currentVisitKeyAction(menu.slug, token);
        if (!stopped && latest !== visitKey) {
          setVisitEnded(true);
          store.update(() => []);
          try {
            window.localStorage.removeItem(cartStorageKey(currentScope));
            window.localStorage.removeItem(submissionStorageKey(currentScope));
          } catch {
            /* Server revocation never depends on local storage. */
          }
          router.refresh();
        }
      } catch {
        /* The server independently checks the visit key before orders. */
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(() => void check(), 5000);
    const changed = () => void check();
    window.addEventListener("pageshow", changed);
    window.addEventListener("online", changed);
    document.addEventListener("visibilitychange", changed);
    void check();
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("pageshow", changed);
      window.removeEventListener("online", changed);
      document.removeEventListener("visibilitychange", changed);
    };
  }, [
    context.mode,
    menu.id,
    menu.slug,
    menu.currency,
    token,
    visitKey,
    store,
    router,
  ]);
  const lines = resolveCart(snapshot.items, menu.products);
  const totals = cartTotals(lines);
  const clearPurchased = useCallback(
    (orderId: string, purchased: CartIntent[]) => {
      store.clearPurchased(orderId, purchased);
    },
    [store],
  );
  return {
    ...snapshot,
    visitEnded,
    scope: {
      restaurantId: menu.id,
      mode: context.mode,
      currency: menu.currency,
      visitKey,
    },
    notice,
    ...totals,
    lines,
    context,
    menu,
    async add(product: MenuProduct, optionIds: string[], quantity: number, notes = "") {
      if (!validSpecialRequest(notes)) return "Keep your special request to 300 characters.";
      const error = validateSelection(product, optionIds, quantity);
      if (error) return error;
      const result = await validateCartAddition(
        menu.slug,
        product.id,
        optionIds,
        quantity,
        productRevision(product),
        token,
        visitKey,
      );
      if (!result.ok) {
        if (result.refresh) {
          setNotice(result.message);
          router.refresh();
        }
        return result.message;
      }
      try {
        setNotice(undefined);
        store.update((items) =>
          addCartItem(items, { productId: product.id, optionIds, quantity, notes }),
        );
        return null;
      } catch (error) {
        return error instanceof Error
          ? error.message
          : "Couldn’t add this dish.";
      }
    },
    setQuantity(key: string, quantity: number) {
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return;
      store.update((items) =>
        items.map((item) =>
          cartLineKey(item) === key ? { ...item, quantity } : item,
        ),
      );
    },
    setNotes(key: string, notes: string) {
      try {
        store.update((items) => updateCartItemNotes(items, key, notes));
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : "Your request could not be saved. Try again.";
      }
    },
    remove(key: string) {
      store.update((items) =>
        items.filter((item) => cartLineKey(item) !== key),
      );
    },
    clearPurchased,
  };
}
const CartContext = createContext<ReturnType<typeof useCartState> | null>(null);
export function CartProvider({
  menu,
  context,
  children,
}: {
  menu: RestaurantMenu;
  context: CustomerContext;
  children: React.ReactNode;
}) {
  const cart = useCartState(menu, context);
  return (
    <CartContext.Provider value={cart}>
      {cart.visitEnded ? (
        <div role="status" className="mx-auto max-w-lg p-8">
          <h1 className="font-display text-3xl">This visit has ended.</h1>
          <p className="mt-4 text-sm leading-7 text-muted">
            Your previous orders and selections are no longer available. Scan
            your table QR to start a fresh visit.
          </p>
          <a
            href={`/r/${menu.slug}${context.table.status === "valid" ? `?table=${context.table.token}` : ""}`}
            className="mt-5 inline-flex min-h-12 items-center font-medium text-accent"
          >
            Open a fresh menu →
          </a>
        </div>
      ) : (
        children
      )}
    </CartContext.Provider>
  );
}
export function useCart() {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("CartProvider is required.");
  return cart;
}

export function CartNotice() {
  const { notice, storageError, ready } = useCart();
  if (!notice && !(ready && storageError)) return null;
  return (
    <div
      role="status"
      className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
    >
      {notice && <p>{notice}</p>}
      {ready && storageError && (
        <p>
          Your browser cannot save this bag. Keep this page open to retain your
          selections.
        </p>
      )}
    </div>
  );
}
