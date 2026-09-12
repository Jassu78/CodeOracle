import { describe, expect, it } from "vitest";
import RedisMock from "ioredis-mock";
import {
  forceReleaseIndexLease,
  touchIndexLease,
  tryAcquireIndexLease,
} from "../src/lib/index-lease.js";

describe("index lease", () => {
  it("NX acquire — second holder fails", async () => {
    const redis = new RedisMock();
    const a = await tryAcquireIndexLease(redis as never, "repo-a");
    expect(a).not.toBeNull();
    const b = await tryAcquireIndexLease(redis as never, "repo-a");
    expect(b).toBeNull();
    await a!.release();
    const c = await tryAcquireIndexLease(redis as never, "repo-a");
    expect(c).not.toBeNull();
    await c!.release();
  });

  it("leases are independent per repo", async () => {
    const redis = new RedisMock();
    const a = await tryAcquireIndexLease(redis as never, "r1");
    const b = await tryAcquireIndexLease(redis as never, "r2");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    await a!.release();
    await b!.release();
  });

  it("touch extends an existing lease; forceRelease clears it", async () => {
    const redis = new RedisMock();
    const lease = await tryAcquireIndexLease(redis as never, "repo-x");
    expect(lease).not.toBeNull();
    await touchIndexLease(redis as never, "repo-x");
    await forceReleaseIndexLease(redis as never, "repo-x");
    const again = await tryAcquireIndexLease(redis as never, "repo-x");
    expect(again).not.toBeNull();
    await again!.release();
  });

  it("release is owner-safe (does not delete a newer lease)", async () => {
    const redis = new RedisMock();
    const a = await tryAcquireIndexLease(redis as never, "repo-y");
    expect(a).not.toBeNull();
    await forceReleaseIndexLease(redis as never, "repo-y");
    const b = await tryAcquireIndexLease(redis as never, "repo-y");
    expect(b).not.toBeNull();
    await a!.release();
    // B must still hold the key
    const c = await tryAcquireIndexLease(redis as never, "repo-y");
    expect(c).toBeNull();
    await b!.release();
  });
});
