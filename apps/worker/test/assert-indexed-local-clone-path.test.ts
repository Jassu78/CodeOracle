import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AllowedRootsError, type Env } from "@codeoracle/config";
import { assertIndexedLocalClonePath } from "../src/lib/assert-indexed-local-clone-path.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function envStub(partial: Partial<Env> & Pick<Env, "NODE_ENV" | "CODEORACLE_ALLOWED_ROOTS">): Env {
  return partial as Env;
}

describe("assertIndexedLocalClonePath", () => {
  it("allows any path in development when roots unset", () => {
    const out = assertIndexedLocalClonePath(
      envStub({ NODE_ENV: "development", CODEORACLE_ALLOWED_ROOTS: undefined }),
      "/tmp/whatever",
    );
    expect(out).toContain("whatever");
  });

  it("refuses outside roots in production", () => {
    const base = makeTempDir("co-worker-jail-");
    const allowed = join(base, "allowed");
    const outside = join(base, "outside");
    mkdirSync(allowed, { recursive: true });
    mkdirSync(outside, { recursive: true });

    expect(() =>
      assertIndexedLocalClonePath(
        envStub({ NODE_ENV: "production", CODEORACLE_ALLOWED_ROOTS: [allowed] }),
        outside,
      ),
    ).toThrow(AllowedRootsError);
  });

  it("refuses symlink escape at index time (F2)", () => {
    const base = makeTempDir("co-worker-symlink-");
    const allowed = join(base, "allowed");
    const outside = join(base, "outside");
    mkdirSync(allowed, { recursive: true });
    mkdirSync(outside, { recursive: true });
    const escapeLink = join(allowed, "escape");
    symlinkSync(outside, escapeLink);

    expect(() =>
      assertIndexedLocalClonePath(
        envStub({ NODE_ENV: "production", CODEORACLE_ALLOWED_ROOTS: [allowed] }),
        escapeLink,
      ),
    ).toThrow(AllowedRootsError);
  });
});
