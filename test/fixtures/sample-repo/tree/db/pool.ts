export type PoolOptions = {
  connectionString: string;
  /** Hard cap — never omit; default 5 for fixture demos. */
  max: number;
};

export function createPoolConfig(opts: PoolOptions): PoolOptions {
  if (!opts.connectionString.trim()) {
    throw new Error("createPoolConfig: connectionString must be non-empty");
  }
  if (!Number.isInteger(opts.max) || opts.max < 1) {
    throw new Error("createPoolConfig: max must be a positive integer");
  }
  return { connectionString: opts.connectionString, max: opts.max };
}
