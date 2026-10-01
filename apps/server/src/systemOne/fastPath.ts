/**
 * fastPath - trims a turn's provider input for simple questions.
 *
 * Trims at the record level BEFORE composing: the live message stays intact
 * while the oldest context records are dropped first. Post-composition
 * truncation would risk cutting the live message when records bloat the
 * head of the composed string. Counts (not bytes) drive the trim, so no
 * record schema knowledge is needed; the receipt reports what was dropped.
 *
 * @module fastPath
 */

/** Most-recent context records kept; older ones are dropped first. */
export const FAST_PATH_MAX_RECORDS = 8;

export interface TrimmedFastPathInput<T> {
  readonly text: string;
  readonly records: ReadonlyArray<T>;
  readonly trimmed: boolean;
  readonly droppedRecords: number;
  readonly textCharsSaved: number;
}

export const trimForFastPath = <T>(
  text: string,
  records: ReadonlyArray<T>,
): TrimmedFastPathInput<T> => {
  const droppedRecords = Math.max(0, records.length - FAST_PATH_MAX_RECORDS);
  const kept = droppedRecords > 0 ? records.slice(droppedRecords) : records;
  return {
    text,
    records: kept,
    trimmed: droppedRecords > 0,
    droppedRecords,
    textCharsSaved: 0,
  };
};
