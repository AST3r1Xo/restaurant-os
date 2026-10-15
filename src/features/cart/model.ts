import type { MenuProduct } from "../menu/types.ts";

export type CartIntent = {
  productId: string;
  optionIds: string[];
  quantity: number;
};
export type CartLine = CartIntent & {
  key: string;
  product?: MenuProduct;
  options: {
    id: string;
    group: string;
    name: string;
    priceAdjustmentMinor: number;
  }[];
  unitPriceMinor: number;
  totalMinor: number;
  error?: string;
};
export const MAX_QUANTITY = 99;
export const MAX_LINES = 100;

export function cartLineKey(item: Pick<CartIntent, "productId" | "optionIds">) {
  return JSON.stringify([item.productId, [...item.optionIds].sort()]);
}
export function productRevision(product: MenuProduct) {
  return JSON.stringify([
    product.id,
    product.priceMinor,
    product.modifierGroups,
  ]);
}
export function validateSelection(
  product: MenuProduct,
  optionIds: unknown,
  quantity: unknown,
) {
  if (
    !Number.isInteger(quantity) ||
    (quantity as number) < 1 ||
    (quantity as number) > MAX_QUANTITY
  )
    return "Choose a quantity between 1 and 99.";
  if (
    !Array.isArray(optionIds) ||
    optionIds.length > 100 ||
    optionIds.some((id) => typeof id !== "string") ||
    new Set(optionIds).size !== optionIds.length
  )
    return "Please review your selections.";
  const known = new Set(
    product.modifierGroups.flatMap((group) =>
      group.options.map((option) => option.id),
    ),
  );
  if (optionIds.some((id) => !known.has(id)))
    return "An option is no longer available. Please choose again.";
  for (const group of product.modifierGroups) {
    const count = group.options.filter((option) =>
      optionIds.includes(option.id),
    ).length;
    if (count < group.minSelections)
      return `Choose at least ${group.minSelections} for ${group.name.toLowerCase()}.`;
    if (
      count > group.maxSelections ||
      (group.selectionType === "single" && count > 1)
    )
      return `Choose up to ${group.maxSelections} for ${group.name.toLowerCase()}.`;
  }
  const unitPrice =
    product.priceMinor +
    product.modifierGroups
      .flatMap((group) => group.options)
      .filter((option) => optionIds.includes(option.id))
      .reduce((sum, option) => sum + option.priceAdjustmentMinor, 0);
  if (
    !Number.isSafeInteger(unitPrice) ||
    unitPrice < 0 ||
    !Number.isSafeInteger(unitPrice * (quantity as number))
  )
    return "This dish cannot be added right now.";
  return null;
}
export function resolveCart(
  items: CartIntent[],
  products: MenuProduct[],
): CartLine[] {
  return items.map((item) => {
    const product = products.find((product) => product.id === item.productId);
    const error = product
      ? validateSelection(product, item.optionIds, item.quantity)
      : "This dish is no longer available.";
    const options =
      product?.modifierGroups.flatMap((group) =>
        group.options
          .filter((option) => item.optionIds.includes(option.id))
          .map((option) => ({ ...option, group: group.name })),
      ) ?? [];
    const unitPriceMinor = error
      ? 0
      : product!.priceMinor +
        options.reduce((sum, option) => sum + option.priceAdjustmentMinor, 0);
    return {
      ...item,
      key: cartLineKey(item),
      product,
      options,
      unitPriceMinor,
      totalMinor: unitPriceMinor * item.quantity,
      error: error ?? undefined,
    };
  });
}
export function cartTotals(lines: CartLine[]) {
  return {
    count: lines
      .filter((line) => !line.error)
      .reduce((sum, line) => sum + line.quantity, 0),
    subtotalMinor: lines.reduce((sum, line) => sum + line.totalMinor, 0),
    hasInvalidItems: lines.some((line) => !!line.error),
  };
}
export function addCartItem(
  items: CartIntent[],
  item: CartIntent,
): CartIntent[] {
  const key = cartLineKey(item);
  const existing = items.find((line) => cartLineKey(line) === key);
  if (existing && existing.quantity + item.quantity > MAX_QUANTITY)
    throw new Error("You can add up to 99 of the same dish.");
  if (!existing && items.length >= MAX_LINES)
    throw new Error("Your bag is full. Please remove a dish first.");
  const canonical = { ...item, optionIds: [...item.optionIds].sort() };
  return existing
    ? items.map((line) =>
        cartLineKey(line) === key
          ? { ...line, quantity: line.quantity + item.quantity }
          : line,
      )
    : [...items, canonical];
}

// A confirmed purchase removes only its quantities. Dishes added while a
// request was in flight remain in the bag, including matching customizations.
export function subtractPurchasedItems(
  items: CartIntent[],
  purchased: CartIntent[],
): CartIntent[] {
  const quantities = new Map<string, number>();
  for (const item of purchased) {
    const key = cartLineKey(item);
    quantities.set(key, (quantities.get(key) ?? 0) + item.quantity);
  }
  return items.flatMap((item) => {
    const remaining = item.quantity - (quantities.get(cartLineKey(item)) ?? 0);
    return remaining > 0 ? [{ ...item, quantity: remaining }] : [];
  });
}
