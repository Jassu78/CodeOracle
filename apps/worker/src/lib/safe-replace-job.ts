import type { Job, JobsOptions, Queue } from "bullmq";

/**
 * Remove a BullMQ job only when it is idle.
 * Never steals an active / waiting-children lock (throws "could not be removed because it is locked").
 */
export async function safeRemoveJobIfIdle(job: Job): Promise<boolean> {
  const state = await job.getState();
  if (state === "active" || state === "waiting-children") {
    return false;
  }
  try {
    await job.remove();
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/locked|could not be removed/i.test(msg)) {
      return false;
    }
    throw err;
  }
}

export type SafeReplaceJobResult = "added" | "replaced" | "skipped_active";

/** Remove idle prior job with the same id (if any), then add. Skip when active. */
export async function safeReplaceJob(opts: {
  queue: Queue;
  name: string;
  jobId: string;
  data: unknown;
  jobOpts?: JobsOptions;
}): Promise<SafeReplaceJobResult> {
  const existing = await opts.queue.getJob(opts.jobId);
  if (existing) {
    const removed = await safeRemoveJobIfIdle(existing);
    if (!removed) return "skipped_active";
    await opts.queue.add(opts.name, opts.data, {
      jobId: opts.jobId,
      ...opts.jobOpts,
    });
    return "replaced";
  }

  await opts.queue.add(opts.name, opts.data, {
    jobId: opts.jobId,
    ...opts.jobOpts,
  });
  return "added";
}
