/**
 * Re-export of the shared id helpers. The prefix map lives in @kase/db so
 * this app and apps/api cannot disagree about what a `usr_` id looks like —
 * this app mints them, that one validates them out of a JWT claim.
 */
export { ID_PREFIX, newId, isId, assertId } from '@kase/db/ids';
export type { IdKind } from '@kase/db/ids';
