export const MAX_SPECIAL_REQUEST_LENGTH = 300;

export function validSpecialRequest(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_SPECIAL_REQUEST_LENGTH &&
    [...value].every((character) => {
      const code = character.codePointAt(0)!;
      return (code >= 32 && code !== 127) || code === 9 || code === 10 || code === 13;
    });
}

export function normalizeSpecialRequest(value: string = "") {
  return value.replace(/\r\n?/g, "\n").trim();
}

// Omit empty requests so existing carts, reviews and durable retries retain
// their original identity. Notes are plain text, never pricing instructions.
export function specialRequestFields(notes?: string) {
  const value = normalizeSpecialRequest(notes);
  return value ? { notes: value } : {};
}
