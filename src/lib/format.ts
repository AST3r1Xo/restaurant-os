export function formatMoney(
  amountMinor: number,
  currency = "EUR",
  locale = "en-IE",
) {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    amountMinor / 100,
  );
}
