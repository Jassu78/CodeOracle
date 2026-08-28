import { describe, expect, it } from "vitest";
import { runDoctor } from "./doctor.js";

describe("runDoctor", () => {
  it("runs all checks and returns a boolean without throwing", async () => {
    const result = await runDoctor();
    expect(typeof result).toBe("boolean");
  });
});
