import { describe, expect, it } from "vitest";
import { clamp, formatBytes, formatDate } from "./format";

describe("format helpers", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  });

  it("formats sqlite datetimes", () => {
    const value = formatDate("2026-09-01 08:30:00");
    expect(value).toMatch(/09\/01/);
  });

  it("clamps values", () => {
    expect(clamp(5, 14, 34)).toBe(14);
    expect(clamp(40, 14, 34)).toBe(34);
    expect(clamp(20, 14, 34)).toBe(20);
  });
});
