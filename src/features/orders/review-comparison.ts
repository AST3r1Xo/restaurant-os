import { cartLineKey } from "../cart/model.ts";
import type { CartLine } from "../cart/model.ts";
import type { OrderReview } from "./types.ts";

// A server quote may update the editable bag's presentation, but changed
// catalog prices/names/options must never be silently accepted for submission.
export function reviewNeedsAcceptance(
  review: OrderReview,
  lines: CartLine[],
  subtotalMinor: number,
) {
  return (
    review.totalMinor !== subtotalMinor ||
    review.items.length !== lines.length ||
    review.items.some((item) => {
      const key = cartLineKey({
        productId: item.productId,
        optionIds: item.options.map((option) => option.id),
        notes: item.notes,
      });
      const line = lines.find((line) => line.key === key);
      return (
        !line ||
        !!line.error ||
        line.quantity !== item.quantity ||
        line.product?.name !== item.productName ||
        line.unitPriceMinor !== item.unitPriceMinor ||
        line.options.length !== item.options.length ||
        line.options.some((option) => {
          const selected = item.options.find(
            (selected) => selected.id === option.id,
          );
          return (
            selected?.priceAdjustmentMinor !== option.priceAdjustmentMinor ||
            selected?.name !== option.name ||
            selected?.groupName !== option.group
          );
        })
      );
    })
  );
}
