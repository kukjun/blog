---
title: "Can a UNIQUE constraint prevent overlapping reservations?"
description: "Two reservations can pass a duplicate check inside separate transactions. I reproduce the race with real PostgreSQL connections and compare what a UNIQUE constraint and a range exclusion constraint actually reject."
pubDate: 2024-05-25
updatedDate: 2026-09-14
lang: en
tags: ["concurrency", "Redis", "PostgreSQL", "databases"]
translationKey: "redis-distributed-lock"
draft: false
---

While building a reservation feature, I wanted to check whether putting the duplicate check and insert inside a transaction made concurrent requests safe. [The original May 2024 post](https://velog.io/@imkkuk/Redis%EB%A1%9C-%EB%8F%99%EC%8B%9C%EC%84%B1-%EB%AC%B8%EC%A0%9C-%ED%95%B4%EA%B2%B0%ED%95%98%EA%B8%B0) starts by looking for possible concurrency problems in a side project. It was not an account of a confirmed customer double-booking incident.

The post records SQL sequences for one request, two requests spaced apart, and two arriving close together. In the last sequence, both requests found no conflicting reservation, then inserted and committed. At the time, I described putting a Redis lock around the check and write.

Revisiting it, I first needed to state the reservation rule precisely. Rejecting reservations with identical start and end times is not enough. The same resource must not accept both `10:00–11:00` and `10:30–11:30`. Their endpoints differ, but their time ranges overlap.

## Define overlap before choosing a constraint

I used half-open intervals, `[start, end)`: include the start and exclude the end. That lets `11:00–12:00` follow `10:00–11:00` without a conflict. Two ranges overlap when:

```sql
existing.starts_at < requested.ends_at
AND existing.ends_at > requested.starts_at
```

On September 14, 2026, I ran a new experiment with **PostgreSQL 18.4 and pg 8.16.3**. It checks what changes when that same interval rule is expressed in the database. It is not a load test of the original Redis implementation. I used two real connections and explicitly selected `READ COMMITTED` isolation.

Both requests target the same resource. The date is synthetic test data, and the timestamps specify UTC to avoid ambiguity about their timezone.

```text
A: resource_id=1, [2030-01-01 10:00Z, 11:00Z)
B: resource_id=1, [2030-01-01 10:30Z, 11:30Z)
```

## BEGIN did not serialize both checks and writes

I began a transaction on each connection and made both check for overlaps before either one wrote a row.

```sql
SELECT count(*)
FROM reservation_none
WHERE resource_id = $1
  AND starts_at < $3::timestamptz
  AND ends_at > $2::timestamptz;
```

Here, `$2` is the requested start and `$3` is the end. After confirming that both reads returned 0, I inserted A and B, committed B and then A, and counted the rows through a separate connection. There were two.

| Step | Connection A | Connection B |
| --- | --- | --- |
| 1 | `BEGIN` | `BEGIN` |
| 2 | Overlap count: 0 | Overlap count: 0 |
| 3 | Insert range A | Insert range B |
| 4 | `COMMIT` | `COMMIT` |

A transaction allows each request's work to commit or roll back together. But after both reads pass, nothing in this code decides which write to reject. The ordinary `SELECT` in this experiment does not reserve an empty interval against another request. Results under `SERIALIZABLE` or additional locking need to be considered separately.

## UNIQUE on the endpoints produced the same result

I repeated the experiment with this constraint:

```sql
UNIQUE (resource_id, starts_at, ends_at)
```

Both rows were stored because A and B have different start and end times. Inserting the exact A range again produced a `23505` unique violation. The constraint worked; **equal values and overlapping intervals are different conditions**.

A UNIQUE constraint on a resource and a fixed time slot would require changing the model to fixed slots first. This experiment keeps the original problem's arbitrary start and end times.

## Reject the overlap itself

PostgreSQL can use range types and exclusion constraints to prevent two rows from satisfying a specified relationship at the same time. I used `btree_gist` to combine equality on the resource ID with overlap on the time range in one GiST constraint.

```sql
CREATE EXTENSION btree_gist;

CREATE TABLE reservation_exclude (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id integer NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CHECK (starts_at < ends_at),
  EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
);
```

This forbids a pair of rows where both `resource_id WITH =` and the range's `WITH &&` are true: the resource is the same and the intervals overlap. `NOT NULL` and the `CHECK` also require a nonempty interval with its start before its end.

Both preliminary reads still returned 0. I inserted A without committing, then sent B's insert. This time, `pg_blocking_pids()` showed B waiting for A. When A committed, B failed with `23P01`, an exclusion constraint violation. After rolling B back, the final row count was one.

```text
A INSERT, still uncommitted
B INSERT, waits for A to finish
A COMMIT
B INSERT fails: SQLSTATE 23P01
B ROLLBACK
COUNT(*) through a separate connection = 1
```

Making the overlap query faster was not the fix. The rule is now enforced when the database accepts a write. A preliminary query can still provide an early response, but its result cannot replace handling a conflict at the final write. An application should map `23P01` to its reservation-unavailable response. The example verifies the SQL error and rollback; it does not implement an HTTP response layer.

## Record the rule that each case checked

| Condition | Observed result |
| --- | --- |
| No constraint, overlapping ranges | Both checks returned 0; two final rows |
| UNIQUE on endpoints, overlapping ranges | Both checks returned 0; two final rows |
| Identical range inserted into the UNIQUE table | Rejected with `23505` |
| Exclusion constraint, same resource and overlapping ranges | B waited, then received `23P01`; one final row |
| Exclusion constraint, adjacent range on the same resource | Insert succeeded |
| Exclusion constraint, overlapping range on another resource | Insert succeeded |
| Empty interval with identical start and end | Rejected with `23514` |

The original post does not establish why Redis was necessary instead of a database constraint. I will not add a need to coordinate multiple databases or external operations that the record does not show. The question answered by this new experiment is how to prevent overlapping reservation intervals stored in one database.

The schema does not model retained canceled reservations, resources with capacity greater than one, or whether a waiting reservation occupies capacity. Those rules would change what the constraint needs to cover. What this experiment does provide is a way to go beyond “the duplicate check is in a transaction” and verify whether the database enforces the relationship the application needs.

## Run the experiment

The [complete reproduction](/blog/examples/database-transactions.mjs) runs a real PostgreSQL server with temporary data and a private Unix socket. It uses neither an existing database nor a TCP port, and cleans up the server and data when finished. I ran it with Node.js 24.15.0 on macOS arm64. Its `reservations` output contains the constraint comparisons and boundary checks.

```bash
work="$(mktemp -d)"
npm install --prefix "$work" embedded-postgres@18.4.0-beta.17 pg@8.16.3
BLOG_DB_NODE_MODULES="$work/node_modules" node public/examples/database-transactions.mjs
```

If you downloaded the example separately, change the final path to its location. This is not a throughput benchmark. It explicitly schedules both checks before the writes and observes the exclusion constraint's actual wait to verify the conflict path.

## References

- [Range Types: Constraints on Ranges](https://www.postgresql.org/docs/18/rangetypes.html#RANGETYPES-CONSTRAINT) (PostgreSQL 18): equality, overlap, and per-resource exclusion constraints
- [Constraints](https://www.postgresql.org/docs/18/ddl-constraints.html) (PostgreSQL 18): UNIQUE, CHECK, and exclusion constraints
- [Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html) (PostgreSQL 18): read isolation and concurrent transactions
- [Error Codes](https://www.postgresql.org/docs/18/errcodes-appendix.html) (PostgreSQL 18): `23505`, `23P01`, and `23514`
