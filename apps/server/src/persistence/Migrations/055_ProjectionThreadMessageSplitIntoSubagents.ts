import * as Effect from "effect/Effect";

/**
 * Placeholder for a migration that was removed before release. It added a
 * `split_into_subagents` column for the reverted "Split into subagents" switch.
 * Databases that already ran it have id 55 recorded, and the migrator skips
 * any id at or below the latest recorded one, so the id stays taken: the next
 * real migration is 056. Running this does nothing; the unused column, where
 * present, is harmless.
 */
export default Effect.void;
