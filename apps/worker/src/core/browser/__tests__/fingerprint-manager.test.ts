import { describe, it, expect, vi } from "vitest";
import {
  generateFingerprintForAccount,
  validateFingerprintConsistency,
  FingerprintInconsistencyError,
} from "../fingerprint-manager.js";

vi.mock("node:child_process", () => ({
  execSync: () => "Google Chrome 148.0.7778.168\n",
}));

describe("validateFingerprintConsistency", () => {
  const base = () =>
    generateFingerprintForAccount("acc-test-1", {
      country: "US",
      city: "Chicago",
    });

  it("accepts a generated fingerprint", () => {
    expect(() => validateFingerprintConsistency(base())).not.toThrow();
  });

  it("rejects Windows UA with MacIntel platform", () => {
    const fp = base();
    fp.platform = "MacIntel";
    expect(() => validateFingerprintConsistency(fp)).toThrow(
      FingerprintInconsistencyError,
    );
  });

  it("rejects viewport wider than screen", () => {
    const fp = base();
    fp.viewport.width = fp.screen.width + 100;
    expect(() => validateFingerprintConsistency(fp)).toThrow(/viewport.width/);
  });

  it("rejects viewport that leaves no chrome space", () => {
    const fp = base();
    fp.viewport.height = fp.screen.height - 10;
    expect(() => validateFingerprintConsistency(fp)).toThrow(/taskbar/);
  });

  it("rejects locale/timezone mismatch", () => {
    const fp = base();
    fp.locale = "ru-RU";
    fp.timezone = "America/Chicago";
    expect(() => validateFingerprintConsistency(fp)).toThrow(/locale/);
  });

  it("rejects unrealistic deviceMemory", () => {
    const fp = base();
    (fp as any).deviceMemory = 32;
    expect(() => validateFingerprintConsistency(fp)).toThrow(/deviceMemory/);
  });

  it("rejects Chrome major mismatch", () => {
    const fp = base();
    fp.chromeMajor = 100;
    expect(() => validateFingerprintConsistency(fp)).toThrow(/Chrome major/);
  });

  it("rejects non-zero maxTouchPoints on desktop UA", () => {
    const fp = base();
    fp.maxTouchPoints = 5 as any;
    expect(() => validateFingerprintConsistency(fp)).toThrow(/maxTouchPoints/);
  });

  it("is deterministic per accountId", () => {
    const a = generateFingerprintForAccount("acc-XYZ", {
      country: "US",
      city: "Chicago",
    });
    const b = generateFingerprintForAccount("acc-XYZ", {
      country: "US",
      city: "Chicago",
    });
    expect(a).toEqual(b);
  });

  it("differs across accountIds", () => {
    const a = generateFingerprintForAccount("acc-A", {
      country: "US",
      city: "Chicago",
    });
    const b = generateFingerprintForAccount("acc-B", {
      country: "US",
      city: "Chicago",
    });
    expect(a.canvas.seed).not.toEqual(b.canvas.seed);
  });
});
