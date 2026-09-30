/**
 * judgmentTypes - the four System One question shapes, vendored locally.
 *
 * These mirror the TypeSafe Jev `system_one` API (which Laya reproduced), so
 * the question wording in `stateBuilder.ts` stays provider-independent and no
 * inference package is needed for types.
 *
 * @module judgmentTypes
 */
export type QuestionType = "choice" | "score" | "noul";

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** option -> short description (or null), or a plain list of option names */
  criteria: Record<string, string | null> | string[];
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  /** ordered levels, index 0 = lowest; at least two so a score is meaningful */
  criteria: readonly [string, string, ...string[]];
}

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: {
    true?: string;
    false?: string;
  };
}

export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion;
