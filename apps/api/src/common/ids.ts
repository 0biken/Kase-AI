/**
 * Prefixed ULIDs, per 14-api §1 ("IDs | Prefixed ULIDs (`aud_01H...`)").
 *
 * The implementation lives in @kase/db, not here, because apps/web mints
 * user ids on invite acceptance and this app's AuthGuard validates them out
 * of a JWT claim. Two copies of the prefix map could drift, and the failure
 * mode is every sign-in rejected at runtime with nothing failing at compile
 * time. One map, one package.
 *
 * Re-exported rather than imported directly at call sites so the ~40
 * existing `from '../common/ids'` imports keep working.
 *
 * ULID over UUID because the docs say so, but the reason it is the right
 * call: ULIDs sort lexicographically by creation time, which is what makes
 * the cursor pagination in §1 work without a separate sort column. A random
 * UUID cursor would need one.
 *
 * The prefix is not decoration. When a finding cites an ID in a report, or a
 * CI log shows one, the prefix says what it refers to without a lookup — and
 * a mis-scoped query that passes `aud_...` where `prj_...` belongs fails
 * loudly instead of silently returning nothing.
 */
export { ID_PREFIX, newId, isId, assertId } from '@kase/db/ids';
export type { IdKind } from '@kase/db/ids';
