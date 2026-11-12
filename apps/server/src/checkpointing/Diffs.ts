export interface TurnDiffFileSummary {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

/** Reads Git's NUL-delimited numstat output without decoding display paths. */
export function parseTurnDiffFilesFromNumstat(numstat: string): ReadonlyArray<TurnDiffFileSummary> {
  const records = numstat.split("\0");
  const files: TurnDiffFileSummary[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const counts = /^(\d+|-)\t(\d+|-)\t/.exec(record);
    if (!counts) continue;

    let path = record.slice(counts[0].length);
    if (path.length === 0) {
      // Renames and copies use two more records: the source and destination.
      path = records[index + 2] ?? "";
      index += 2;
    }
    if (path.length === 0) continue;

    files.push({
      path,
      additions: counts[1] === "-" ? 0 : Number(counts[1]),
      deletions: counts[2] === "-" ? 0 : Number(counts[2]),
    });
  }

  return files.toSorted((left, right) => left.path.localeCompare(right.path));
}

/** What a checkpoint did to a file, in the words `VcsFileChangeKind` uses. */
export type TurnDiffFileKind =
  | "added"
  | "deleted"
  | "modified"
  | "renamed"
  | "copied"
  | "type-changed";

export interface TurnDiffFileWithKind extends TurnDiffFileSummary {
  readonly kind: TurnDiffFileKind;
}

const RAW_STATUS_KINDS: Record<string, TurnDiffFileKind> = {
  A: "added",
  D: "deleted",
  M: "modified",
  R: "renamed",
  C: "copied",
  T: "type-changed",
};

/**
 * Reads one `git diff --raw --numstat -z` run: the raw records (":mode mode sha sha STATUS", then
 * the path, or the source and destination for a rename or copy) come first, then the numstat
 * records. One git call gives each file its kind and its counts; a status this does not know
 * reads as modified.
 */
export function parseTurnDiffFilesFromRawNumstat(
  output: string,
): ReadonlyArray<TurnDiffFileWithKind> {
  const records = output.split("\0");
  const kinds = new Map<string, TurnDiffFileKind>();
  let index = 0;
  for (; index < records.length; index += 1) {
    const record = records[index]!;
    if (!record.startsWith(":")) break;
    const status = record.slice(record.lastIndexOf(" ") + 1);
    const letter = status.charAt(0);
    const twoPaths = letter === "R" || letter === "C";
    const path = records[index + (twoPaths ? 2 : 1)] ?? "";
    index += twoPaths ? 2 : 1;
    if (path.length > 0) kinds.set(path, RAW_STATUS_KINDS[letter] ?? "modified");
  }
  return parseTurnDiffFilesFromNumstat(records.slice(index).join("\0")).map((file) => ({
    ...file,
    kind: kinds.get(file.path) ?? "modified",
  }));
}
