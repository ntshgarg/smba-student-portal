import type { TrainingBatch, TrainingProgramme } from "@/lib/sessions/types"

/*
 * Sentinels for tests that assert a value is rejected.
 *
 * Three such tests used the literal "Elite", which was a reasonable-sounding
 * non-level right up to the day Elite became a level. Two of them then failed --
 * noisily, which was lucky. The third mocked the validator, so it kept passing
 * while quietly asserting nothing at all. That is the failure worth preventing:
 * a rejection test that silently becomes an acceptance test.
 *
 * `NotAMemberOf` resolves to `never` the moment its candidate joins the union, so
 * the constant below stops compiling and `npm run typecheck` names this file. The
 * guard fires when the value is added, not when someone later wonders why a test
 * is green.
 */
type NotAMemberOf<TCandidate extends string, TUnion extends string> =
  TCandidate extends TUnion ? never : TCandidate

export const NOT_A_PROGRAMME: NotAMemberOf<"Not a training level", TrainingProgramme>
  = "Not a training level"

export const NOT_A_BATCH: NotAMemberOf<"Not a batch", TrainingBatch> = "Not a batch"
