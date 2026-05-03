import { describe, it, expect } from "vitest";
import { matchSubscribersToUsers } from "./match-subscribers";

describe("matchSubscribersToUsers", () => {
  it("returns empty when both inputs are empty", () => {
    expect(matchSubscribersToUsers([], [])).toEqual([]);
  });

  it("returns empty when no email overlap", () => {
    expect(
      matchSubscribersToUsers(
        [{ id: "s1", email: "a@example.com" }],
        [{ id: "u1", email: "b@example.com" }],
      ),
    ).toEqual([]);
  });

  it("matches exact email", () => {
    expect(
      matchSubscribersToUsers(
        [{ id: "s1", email: "a@example.com" }],
        [{ id: "u1", email: "a@example.com" }],
      ),
    ).toEqual([{ user_id: "u1", mailerlite_subscriber_id: "s1" }]);
  });

  it("matches case-insensitively", () => {
    expect(
      matchSubscribersToUsers(
        [{ id: "s1", email: "A@Example.COM" }],
        [{ id: "u1", email: "a@example.com" }],
      ),
    ).toEqual([{ user_id: "u1", mailerlite_subscriber_id: "s1" }]);
  });

  it("trims whitespace on both sides", () => {
    expect(
      matchSubscribersToUsers(
        [{ id: "s1", email: "  a@b.com  " }],
        [{ id: "u1", email: "a@b.com\n" }],
      ),
    ).toEqual([{ user_id: "u1", mailerlite_subscriber_id: "s1" }]);
  });

  it("skips users with null email", () => {
    expect(
      matchSubscribersToUsers(
        [{ id: "s1", email: "a@b.com" }],
        [
          { id: "u1", email: null },
          { id: "u2", email: "a@b.com" },
        ],
      ),
    ).toEqual([{ user_id: "u2", mailerlite_subscriber_id: "s1" }]);
  });

  it("matches multiple users with same email to the same subscriber", () => {
    const result = matchSubscribersToUsers(
      [{ id: "s1", email: "shared@b.com" }],
      [
        { id: "u1", email: "shared@b.com" },
        { id: "u2", email: "shared@b.com" },
      ],
    );
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.mailerlite_subscriber_id === "s1")).toBe(true);
  });

  it("uses first subscriber when multiple have the same email", () => {
    expect(
      matchSubscribersToUsers(
        [
          { id: "s1", email: "dup@b.com" },
          { id: "s2", email: "dup@b.com" },
        ],
        [{ id: "u1", email: "dup@b.com" }],
      ),
    ).toEqual([{ user_id: "u1", mailerlite_subscriber_id: "s1" }]);
  });

  it("ignores subscribers with empty email", () => {
    expect(
      matchSubscribersToUsers(
        [
          { id: "s1", email: "" },
          { id: "s2", email: "real@b.com" },
        ],
        [{ id: "u1", email: "real@b.com" }],
      ),
    ).toEqual([{ user_id: "u1", mailerlite_subscriber_id: "s2" }]);
  });
});
