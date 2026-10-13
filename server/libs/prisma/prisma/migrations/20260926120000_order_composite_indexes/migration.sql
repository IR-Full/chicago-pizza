-- Fold the single-column indexes on `orders` into the composites the queries
-- actually need.
--
-- Every read of this table narrows and then orders by time: a customer's
-- history (userId → createdAt desc), the analytics range scan (status →
-- createdAt), the kitchen board for one shop (branchId → createdAt). A
-- single-column index answered the narrowing and left Postgres to sort the
-- rest, which on the analytics queries is the expensive half.
--
-- The three dropped indexes are each a prefix of one created here, so nothing
-- loses a usable access path — but `orders` is the hottest INSERT in the
-- system, and it stops maintaining three B-trees that bought nothing.
--
-- Verified on 120k synthetic rows: the customer history and the kitchen board
-- both become `Index Scan Backward` with no sort node, and the analytics range
-- moves both predicates into the index condition.
--
-- Note what is *not* here: `(branchId, status, createdAt)`. The board filters
-- `status NOT IN (…)`, an inequality cannot be an index range, and `createdAt`
-- behind a non-equality column stops driving the ordering — measured, Postgres
-- ignored that index and scanned `createdAt` instead. `(branchId, createdAt)`
-- puts the sort column directly behind the query's one equality, which is what
-- produces the ordered scan.
--
-- `CREATE INDEX` (not CONCURRENTLY) takes a SHARE lock: reads continue, writes
-- wait. Deliberate — Prisma runs each migration in a transaction and
-- CONCURRENTLY cannot run inside one, and on a table this size the wait is
-- milliseconds. Revisit if `orders` ever reaches the millions.

-- DropIndex
DROP INDEX "orders_branchId_status_idx";

-- DropIndex
DROP INDEX "orders_status_idx";

-- DropIndex
DROP INDEX "orders_userId_idx";

-- CreateIndex
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_branchId_createdAt_idx" ON "orders"("branchId", "createdAt");
