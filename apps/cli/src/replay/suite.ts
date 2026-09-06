import { z } from "zod";

const GateSchema = z.enum(["hard", "soft"]).default("hard");

const SearchExpectSchema = z.object({
  /** At least one top hit's filePath **or** symbolName must contain one of these substrings. */
  anyOfPathIncludes: z.array(z.string().min(1)).min(1),
  hitAt: z.number().int().positive().max(50).default(3),
});

const FindExpectSchema = z.object({
  /** Upper bound on result count (bleed / display-cap guard). */
  maxCount: z.number().int().positive().max(50).optional(),
  /** At least one result topic+summary must include one needle (case-insensitive). */
  topicOrSummaryIncludesAny: z.array(z.string().min(1)).min(1),
  requireCitationHttp: z.boolean().default(true),
});

const SearchCaseSchema = z.object({
  id: z.string().min(1),
  tool: z.literal("search_codebase"),
  query: z.string().min(1),
  gate: GateSchema,
  expect: SearchExpectSchema,
});

const FindCaseSchema = z.object({
  id: z.string().min(1),
  tool: z.literal("find_decision"),
  query: z.string().min(1),
  gate: GateSchema,
  expect: FindExpectSchema,
});

export const ReplayCaseSchema = z.discriminatedUnion("tool", [SearchCaseSchema, FindCaseSchema]);

export const ReplaySuiteSchema = z.object({
  version: z.literal(1),
  description: z.string().optional(),
  cases: z.array(ReplayCaseSchema).min(1),
});

export type ReplaySuite = z.infer<typeof ReplaySuiteSchema>;
export type ReplayCase = z.infer<typeof ReplayCaseSchema>;
export type ReplaySearchCase = z.infer<typeof SearchCaseSchema>;
export type ReplayFindCase = z.infer<typeof FindCaseSchema>;
