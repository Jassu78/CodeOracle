import { describe, expect, it, vi } from "vitest";
import { safeRemoveJobIfIdle, safeReplaceJob } from "../src/safe-replace-job.js";

function mockJob(state: string, removeImpl?: () => Promise<void>) {
  return {
    getState: vi.fn(async () => state),
    remove: vi.fn(removeImpl ?? (async () => undefined)),
  };
}

describe("safeRemoveJobIfIdle", () => {
  it("refuses active and waiting-children jobs", async () => {
    expect(await safeRemoveJobIfIdle(mockJob("active") as never)).toBe(false);
    expect(await safeRemoveJobIfIdle(mockJob("waiting-children") as never)).toBe(false);
  });

  it("removes waiting / completed / failed jobs", async () => {
    for (const state of ["waiting", "completed", "failed", "delayed"]) {
      const job = mockJob(state);
      expect(await safeRemoveJobIfIdle(job as never)).toBe(true);
      expect(job.remove).toHaveBeenCalledOnce();
    }
  });

  it("treats BullMQ lock errors as non-fatal skip", async () => {
    const job = mockJob("waiting", async () => {
      throw new Error("could not be removed because it is locked by another worker");
    });
    expect(await safeRemoveJobIfIdle(job as never)).toBe(false);
  });
});

describe("safeReplaceJob", () => {
  it("adds when no prior job", async () => {
    const add = vi.fn(async () => undefined);
    const queue = { getJob: vi.fn(async () => undefined), add };
    const result = await safeReplaceJob({
      queue: queue as never,
      name: "extract_decisions",
      jobId: "j1",
      data: { x: 1 },
    });
    expect(result).toBe("added");
    expect(add).toHaveBeenCalledOnce();
  });

  it("replaces idle prior job", async () => {
    const add = vi.fn(async () => undefined);
    const existing = mockJob("waiting");
    const queue = { getJob: vi.fn(async () => existing), add };
    const result = await safeReplaceJob({
      queue: queue as never,
      name: "full_index",
      jobId: "full",
      data: {},
    });
    expect(result).toBe("replaced");
    expect(existing.remove).toHaveBeenCalledOnce();
  });

  it("skips when prior job is active", async () => {
    const add = vi.fn(async () => undefined);
    const existing = mockJob("active");
    const queue = { getJob: vi.fn(async () => existing), add };
    const result = await safeReplaceJob({
      queue: queue as never,
      name: "full_index",
      jobId: "full",
      data: {},
    });
    expect(result).toBe("skipped_active");
    expect(add).not.toHaveBeenCalled();
  });
});
