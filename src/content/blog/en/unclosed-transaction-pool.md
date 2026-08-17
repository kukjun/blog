---
title: "The heisenbug where updates silently reverted: an unclosed transaction poisoning the pool"
description: "Updates that 'saved' randomly came back as the old value — and only 20–30 minutes after each restart. A story of ruling out the database, the cache, and finally catching a cron job that returned early inside a transaction and handed a poisoned connection back to the pool."
pubDate: 2024-04-01
lang: en
tags: ["databases", "debugging", "reliability", "transactions"]
translationKey: "unclosed-transaction-pool"
draft: false
---

The bug report was the kind that makes you distrust reality. A user updates a value.
It saves. They refresh — and sometimes the *old* value is back. Same request, same
code, different outcome. Then the detail that made it worse: **restarting the server
fixed it, but only for 20–30 minutes,** after which it crept back.

If you've debugged production long enough, "restart fixes it for a while" makes the
back of your neck prickle. It's the signature of a bug that isn't in your logic — it's
in some **shared resource that accumulates state over time.** And the most shared,
most reused resource in a backend is the **database connection pool.**

## Reading the symptoms before touching code

Three facts, together, already point somewhere:

- **Non-deterministic** — identical requests returned different values.
- **Reverting writes** — an update succeeded, then the stale value reappeared.
- **Only 20–30 min after a restart** — never on a fresh process.

A fresh pool has no poisoned connections yet; you have to wait for the offending code
to run *and* for that connection to be handed back out. So: some requests are drawing
a connection that carries someone else's leftover state. Now I had a shape to hunt.

## The investigation (rule out the cheap suspects first)

**Suspect 1 — the database.** MariaDB was current with no known issue for this, and
when I checked who was actually connected, it was only the app and my DataGrip
session. Nothing rogue on the server side. Ruled out.

**Suspect 2 — a cache.** There was no Redis in front of it, and TypeORM's built-in
query cache was disabled. So stale reads weren't a caching artifact. Ruled out.

That left the application's own transaction handling. Two logs closed the case:

1. **App logs.** With structured logging on, I caught two requests at the *same
   timestamp* returning different values — one saw the update, one saw stale data.
   That's the tell: this is **connection-level** state, not data-level state.
2. **SQL logs.** Turning these on exposed the smoking gun: a `START TRANSACTION` with
   **no matching COMMIT or ROLLBACK.**

## The root cause: an early return inside a transaction

A cron job opened a transaction and then `return`ed early on one branch — before the
commit:

```javascript
async badCode() {
  const connection = getConnection();
  try {
    await connection.startTransaction();
    // ...business logic...
    if (A === true) {
      return A;                       // ← returns BEFORE commit/rollback
    }
    await connection.commitTransaction();
    return dto;
  } catch (e) {
    await connection.rollbackTransaction();
  } finally {
    await connection.release();       // released — but the transaction is still OPEN
  }
}
```

Here's the subtle part. The `finally` *does* release the connection, so it looks
"cleaned up." But the early `return` skipped both commit and rollback — so the
connection goes back to the pool with an **open transaction still attached.** It's
returned, but it's *dirty.*

Why that produces stale reads: under MySQL/MariaDB's default **REPEATABLE READ**, a
transaction takes a consistent snapshot at its first read and serves *that* frozen
snapshot for its entire life. A connection stuck mid-transaction keeps showing an old
view of the world to whoever borrows it next.

```mermaid
sequenceDiagram
  participant Cron as Cron job
  participant Pool as Connection pool
  participant User as Later request
  Cron->>Pool: START TRANSACTION, then early return
  Note over Pool: released but DIRTY<br/>(open txn, frozen snapshot)
  User->>Pool: borrow a connection
  Pool-->>User: hands out the dirty one
  User->>User: reads → sees the frozen snapshot<br/>the update "reverted"
```
<span class="figcap">The poison isn't in the data — it's in the connection. Any request unlucky enough to borrow it inherits a stale, frozen view of the database.</span>

That explains every symptom at once: **non-deterministic** (depends which connection
you draw), **reverting** (the frozen snapshot predates the write), and
**warm-up-only** (the cron has to run, and the poisoned connection has to be re-lent).

## The fix — and the discipline behind it

Make **every** path commit or roll back before the connection is released:

```javascript
async goodCode() {
  const connection = getConnection();
  try {
    await connection.startTransaction();
    const dto = A === true
      ? await handleA(connection)
      : await handleNonA(connection);   // compute the branch INSIDE the try
    await connection.commitTransaction();
    return dto;
  } catch (e) {
    await connection.rollbackTransaction();
    throw e;
  } finally {
    await connection.release();          // now always a CLEAN connection
  }
}
```

The immediate fix is `try / commit`, `catch / rollback`, `finally / release`. The
durable fix is to stop hand-managing transaction boundaries at all:

- **Use a transaction abstraction** — `typeorm-transactional` decorators, or a
  `withTransaction(fn)` wrapper — so commit/rollback can't be forgotten on any branch.
- **Never branch or early-return inside a raw transaction block.** Decide the branch
  first, transact second.
- **Log structurally, everywhere.** This bug was caught only because same-timestamp
  logs exposed connection-level divergence. Without that, it hides for weeks.

## What I took away

1. **"Only after warm-up" means shared, reused state.** Look at pools and caches
   before you re-read your own logic.
2. **A leaked transaction's blast radius is the whole pool** — it poisons requests
   that have nothing to do with the bug.
3. **Don't hand-manage what a wrapper can guarantee.** An RAII-style transaction
   helper turns a rule you have to *remember* into one you *can't forget.*

---

## References & further reading

- MySQL — *Consistent Nonlocking Reads* (REPEATABLE READ snapshots). [docs](https://dev.mysql.com/doc/refman/8.0/en/innodb-consistent-read.html)
- MariaDB — *SET TRANSACTION ISOLATION LEVEL*. [docs](https://mariadb.com/kb/en/set-transaction/)
- TypeORM — *Transactions & QueryRunner*. [docs](https://typeorm.io/transactions)
- `typeorm-transactional` — declarative transaction boundaries. [github](https://github.com/Aliheym/typeorm-transactional)
