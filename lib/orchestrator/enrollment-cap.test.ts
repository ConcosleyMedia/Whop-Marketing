import { describe, it, expect } from "vitest";
import { applyEnrollmentCap } from "./enrollment-cap";

describe("applyEnrollmentCap", () => {
  const candidates = ["u1", "u2", "u3", "u4", "u5"];

  it("returns all candidates when cap is null (current behavior)", () => {
    expect(applyEnrollmentCap(candidates, null)).toEqual(candidates);
  });

  it("returns all candidates when cap is undefined", () => {
    expect(applyEnrollmentCap(candidates, undefined)).toEqual(candidates);
  });

  it("returns empty array when cap is 0", () => {
    expect(applyEnrollmentCap(candidates, 0)).toEqual([]);
  });

  it("returns empty array when cap is negative (defensive)", () => {
    expect(applyEnrollmentCap(candidates, -5)).toEqual([]);
  });

  it("returns first N when cap is below candidates length", () => {
    expect(applyEnrollmentCap(candidates, 3)).toEqual(["u1", "u2", "u3"]);
  });

  it("returns all candidates when cap equals candidates length", () => {
    expect(applyEnrollmentCap(candidates, 5)).toEqual(candidates);
  });

  it("returns all candidates when cap exceeds candidates length", () => {
    expect(applyEnrollmentCap(candidates, 100)).toEqual(candidates);
  });

  it("does not mutate the input", () => {
    const input = [...candidates];
    applyEnrollmentCap(input, 2);
    expect(input).toEqual(candidates);
  });

  it("preserves input order (deterministic)", () => {
    expect(applyEnrollmentCap(["z", "y", "x"], 2)).toEqual(["z", "y"]);
  });
});
