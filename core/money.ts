/** Money is stored as integer centavos; these helpers convert for display and input. */

const formatter = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

export function formatPHP(centavos: number): string {
  return formatter.format(centavos / 100);
}

/** Parse what a person types ("1,250", "₱99.5", "12.345") into centavos. Returns null if invalid. */
export function parsePHP(input: string): number | null {
  const cleaned = input.replace(/[₱,\s]/g, "").replace(/^PHP/i, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
