import { describe, expect, it } from "vitest";
import { formatPHP, parsePHP } from "./money";

describe("money", () => {
  it("formats centavos as pesos", () => {
    expect(formatPHP(125000)).toBe("₱1,250.00");
    expect(formatPHP(5)).toBe("₱0.05");
  });

  it("parses typed amounts into centavos", () => {
    expect(parsePHP("1,250")).toBe(125000);
    expect(parsePHP("₱99.5")).toBe(9950);
    expect(parsePHP("PHP 12.345")).toBe(1235);
    expect(parsePHP("abc")).toBeNull();
    expect(parsePHP("")).toBeNull();
  });
});
