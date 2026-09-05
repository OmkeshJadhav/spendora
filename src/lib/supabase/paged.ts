import "server-only";

/**
 * Reading every row a query matches, rather than the first page of them.
 *
 * PostgREST answers an unbounded request with at most `db-max-rows` rows and
 * says so only in the `Content-Range` header. On this project that ceiling is
 * 1000, measured rather than assumed:
 *
 *     Content-Range: 0-999/1500
 *
 * A list that renders one page at a time is unaffected — it asks for a range
 * and gets it. What the ceiling silently truncates is the other kind of read:
 * the ones that exist to be *summed*. A month's spending, a budget's actual, a
 * member's share, the total under a set of filters — each of those fetches
 * every matching amount and adds them up, and a short answer makes the total
 * quietly wrong rather than visibly missing. `lib/export` already pages for
 * exactly this reason; this is the same reasoning applied to the figures on
 * screen, and shared so the two cannot drift.
 *
 * Aggregating in SQL would be better still and is the scaling path, but
 * PostgREST's aggregate functions are disabled on this project
 * (`PGRST123: Use of aggregate functions is not allowed`), and a correctness
 * fix should not depend on a dashboard setting being changed.
 */

/**
 * Rows per request while paging.
 *
 * Matches PostgREST's own ceiling so a full chunk costs one round trip. Asking
 * for more would not return more; asking for less would only add trips.
 */
const CHUNK_SIZE = 1000;

/**
 * The most rows one read will gather before giving up.
 *
 * Deliberately a hard stop rather than a silent truncation — the whole point
 * of this module is that a total which is quietly short is worse than no total
 * at all, because nothing about it says so. Set far above any real month, or
 * any real group's history, so reaching it means something is wrong rather
 * than merely large.
 */
const MAX_ROWS = 50_000;

/**
 * The minimum of a PostgREST query builder this needs.
 *
 * Typed structurally, as `applyExpenseFilters` is and for the same reason: the
 * same paging applies to builders with different generic parameters, and one
 * signature saying `range` is clearer than several saying the same thing.
 */
type RangeableQuery<Row> = PromiseLike<{
  data: Row[] | null;
  error: { message: string } | null;
}>;

/**
 * Every row the built query matches, gathered a chunk at a time.
 *
 * `build` is called once per chunk rather than reused: a PostgREST builder
 * describes one request, so a second `.range()` on the same object would not
 * mean a second page.
 *
 * **The query must carry a deterministic order.** Paging is `LIMIT`/`OFFSET`,
 * and PostgreSQL makes no promise about the order of rows without an
 * `ORDER BY` — so an unordered read could return a row twice, or never, and a
 * total built from it would be wrong in a way no cap explains. Ending the
 * ordering on a unique column (`id`) is what makes it total.
 *
 * Returns the failure rather than throwing it, so each caller can keep its own
 * user-facing wording and its own server-side log line.
 */
export async function readAllRows<Row>(
  build: (from: number, to: number) => RangeableQuery<Row>,
): Promise<{ rows: Row[]; error: string | null }> {
  const rows: Row[] = [];

  for (let offset = 0; ; offset += CHUNK_SIZE) {
    const { data, error } = await build(offset, offset + CHUNK_SIZE - 1);

    if (error) {
      return { rows: [], error: error.message };
    }

    const chunk = data ?? [];
    rows.push(...chunk);

    // A short chunk is the end of the rows; a full one may not be.
    if (chunk.length < CHUNK_SIZE) {
      return { rows, error: null };
    }

    // Checked after appending rather than before fetching, so the ceiling ends
    // the read on the trip that reaches it instead of one trip later.
    if (rows.length >= MAX_ROWS) {
      return {
        rows: [],
        error: `more than ${MAX_ROWS} rows matched; refusing to return a partial total`,
      };
    }
  }
}
