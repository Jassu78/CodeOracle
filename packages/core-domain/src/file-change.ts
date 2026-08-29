export type FileChangeKind = "added" | "modified" | "deleted";

export type FileChange = {
  path: string;
  kind: FileChangeKind;
};

/**
 * Classify `git diff --name-status` / GitHub compare paths into added/modified/deleted.
 * Renames become delete(old) + add(new).
 * Pure domain mapping — worker adapters feed raw status lines in.
 */
export function classifyNameStatusLines(lines: string[]): FileChange[] {
  const out: FileChange[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const parts = line.split("\t");
    const status = parts[0] ?? "";
    const code = status[0] ?? "";

    if (code === "A" && parts[1]) {
      out.push({ path: parts[1], kind: "added" });
    } else if (code === "M" && parts[1]) {
      out.push({ path: parts[1], kind: "modified" });
    } else if (code === "D" && parts[1]) {
      out.push({ path: parts[1], kind: "deleted" });
    } else if (code === "R" && parts[1] && parts[2]) {
      out.push({ path: parts[1], kind: "deleted" });
      out.push({ path: parts[2], kind: "added" });
    } else if (code === "C" && parts[2]) {
      out.push({ path: parts[2], kind: "added" });
    }
  }

  return out;
}

/** Map GitHub compare API `files[].status` into FileChange list. */
export function classifyGithubCompareFiles(
  files: Array<{ filename: string; status: string; previous_filename?: string | null }>,
): FileChange[] {
  const out: FileChange[] = [];
  for (const f of files) {
    const status = f.status.toLowerCase();
    if (status === "added" || status === "copied") {
      out.push({ path: f.filename, kind: "added" });
    } else if (status === "modified" || status === "changed") {
      out.push({ path: f.filename, kind: "modified" });
    } else if (status === "removed") {
      out.push({ path: f.filename, kind: "deleted" });
    } else if (status === "renamed") {
      if (f.previous_filename) out.push({ path: f.previous_filename, kind: "deleted" });
      out.push({ path: f.filename, kind: "added" });
    }
  }
  return out;
}
