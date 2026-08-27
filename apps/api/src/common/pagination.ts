import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Cursor pagination, per 14-api §1: "Pagination | Cursor-based:
 * `?limit=50&cursor=...`".
 *
 * Cursor rather than offset because audits and findings are written while a
 * client is paging. With OFFSET, a row inserted before the cursor shifts the
 * window and the client silently skips a record — for a findings list, that is
 * a missed vulnerability. A cursor anchored to an ID is stable under writes.
 *
 * This works without a sort column because IDs are ULIDs (see ids.ts): they
 * sort lexicographically by creation time.
 */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export interface Page<T> {
  data: T[];
  /** Cursor to pass as `?cursor=` for the next page; null when exhausted. */
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Prisma args for a keyset page.
 *
 * Takes one row more than requested so `hasMore` is known without a second
 * COUNT query — the extra row is dropped by `toPage`.
 */
export function paginationArgs(query: PaginationQueryDto) {
  const limit = query.limit ?? DEFAULT_PAGE_SIZE;
  return {
    take: limit + 1,
    ...(query.cursor
      ? // skip:1 steps past the cursor row itself, which the client already has.
        { cursor: { id: query.cursor }, skip: 1 }
      : {}),
    orderBy: { id: 'asc' as const },
  };
}

/** Trims the lookahead row and derives the next cursor. */
export function toPage<T extends { id: string }>(
  rows: T[],
  query: PaginationQueryDto,
): Page<T> {
  const limit = query.limit ?? DEFAULT_PAGE_SIZE;
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  return {
    data,
    hasMore,
    nextCursor: hasMore && data.length > 0 ? data[data.length - 1].id : null,
  };
}
