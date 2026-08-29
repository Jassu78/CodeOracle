import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import {
  authorizeAdmin,
  authorizeForRepo,
  bearerToken,
  type AuthPrincipal,
} from "../src/lib/auth.js";

function reqWithAuth(header?: string): IncomingMessage {
  return { headers: header ? { authorization: header } : {} } as IncomingMessage;
}

describe("bearerToken", () => {
  it("parses Bearer and rejects empty", () => {
    expect(bearerToken(reqWithAuth("Bearer abc"))).toBe("abc");
    expect(bearerToken(reqWithAuth("Bearer  "))).toBeNull();
    expect(bearerToken(reqWithAuth())).toBeNull();
  });
});

describe("authorizeForRepo (H6)", () => {
  const admin: AuthPrincipal = { kind: "admin" };
  const repoA: AuthPrincipal = { kind: "repo", repoId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", tokenId: "t1" };
  const repoB: AuthPrincipal = { kind: "repo", repoId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", tokenId: "t2" };

  it("allows admin on any repo", () => {
    expect(authorizeForRepo(admin, repoA.repoId, false)).toBe(true);
    expect(authorizeForRepo(admin, repoB.repoId, false)).toBe(true);
  });

  it("allows a repo token only on its minting repo", () => {
    expect(authorizeForRepo(repoA, repoA.repoId, false)).toBe(true);
    expect(authorizeForRepo(repoA, repoB.repoId, false)).toBe(false);
  });

  it("allows open-dev without a principal", () => {
    expect(authorizeForRepo(null, repoA.repoId, true)).toBe(true);
    expect(authorizeForRepo(null, repoA.repoId, false)).toBe(false);
  });
});

describe("authorizeAdmin", () => {
  it("requires admin principal unless open-dev", () => {
    expect(authorizeAdmin({ kind: "admin" }, false)).toBe(true);
    expect(
      authorizeAdmin({ kind: "repo", repoId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", tokenId: "t" }, false),
    ).toBe(false);
    expect(authorizeAdmin(null, true)).toBe(true);
    expect(authorizeAdmin(null, false)).toBe(false);
  });
});
