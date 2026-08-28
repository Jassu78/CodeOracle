import { describe, expect, it } from "vitest";
import { repos, chunks, decisions, jobHistory, apiTokens } from "./index";

describe("Drizzle schema — table sanity", () => {
  it("exports all five core tables", () => {
    expect(repos).toBeDefined();
    expect(chunks).toBeDefined();
    expect(decisions).toBeDefined();
    expect(jobHistory).toBeDefined();
    expect(apiTokens).toBeDefined();
  });

});
