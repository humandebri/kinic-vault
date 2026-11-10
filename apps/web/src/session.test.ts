import { it, expect, vi } from "vitest";
import { Session } from "./session.ts";
it("invalidates pending generations and wipes the raw key on every lock", () => {
  const s = new Session();
  s.raw = new Uint8Array(32).fill(7);
  const raw = s.raw,
    g = s.capture();
  s.lock();
  expect(raw.every((x) => x === 0)).toBe(true);
  expect(s.raw).toBeUndefined();
  expect(() => s.check(g)).toThrow("Locked");
});
it("recomputes inactivity and hidden deadlines on resume", () => {
  let time = 1000;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => time);
  try {
    const s = new Session(),
      g = s.capture();
    s.visible(true);
    time += 60000;
    s.visible(false);
    expect(() => s.check(g)).toThrow("Locked");
    const next = s.capture();
    time += 300000;
    s.activity();
    expect(() => s.check(next)).toThrow("Locked");
  } finally {
    spy.mockRestore();
  }
});
