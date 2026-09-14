---
title: "The connection returned to the pool. The transaction stayed open."
description: "A staging bug returned different values through different connections. I revisit the original investigation, then use a real PostgreSQL server and driver to distinguish uncommitted writes, stale snapshots, and transaction cleanup."
pubDate: 2024-04-01
updatedDate: 2026-09-14
lang: en
tags: ["databases", "debugging", "reliability", "transactions"]
translationKey: "unclosed-transaction-pool"
draft: false
---

While testing in staging, I updated a value and got different results from requests arriving at the same time. Some returned the new value; others returned the old one. Checking and disabling the query cache did not resolve it. I added logs around updates and reads to find out why the result depended on the request.

In [the original April 2024 post](https://velog.io/@imkkuk/Trouble-Shooting-%EC%A2%85%EB%A3%8C%ED%95%98%EC%A7%80-%EC%95%8A%EC%9D%80-Transaction%EC%9D%84-Connection-Pool%EB%A1%9C-%EB%B0%98%ED%99%98), I described enabling SQL logs locally and finding a cron job with an early `return` that skipped both commit and rollback. Its `finally` block returned the connection to the pool without ending the transaction.

Reading that account again, I needed to separate two questions. If only the connection that performed an update can see it, the write may still be uncommitted. If a connection cannot see a write that another connection has committed, the reader may be holding an older snapshot. Calling both symptoms “the value reverted” hides the different SQL sequences we need to examine.

## Returning a connection did not end the database transaction

The original post did not preserve the exact MariaDB and TypeORM patch versions. For the source inspection, I therefore pinned the versions: TypeORM **0.3.26** and mysql2 **3.14.5**. `MysqlQueryRunner.release()` calls the driver connection's `release()`. The default mysql2 release path hands the connection to a waiting borrower or puts it on the idle list. It does not send `COMMIT` or `ROLLBACK`.

```text
QueryRunner.release()
  -> databaseConnection.release()
  -> pool.releaseConnection(connection)
  -> waiting borrower or idle list
```

That is a reading of those specific versions' default implementations. Other drivers or custom release hooks may reset session state. It also does not establish which binary versions ran in 2024.

To check the effect directly, I ran a separate experiment on September 14, 2026, using **PostgreSQL 18.4 and pg 8.16.3**. This is not a recreation of the MariaDB incident in its original environment. It uses a real database server and driver, a pool limited to one connection, and a separate observer connection. The one-connection pool makes the next borrower reuse the same database session.

## When only the writer can see the update

Start with the value 200. The first borrower sends `BEGIN` and returns the connection without ending the transaction. The next borrower performs a normal update without explicitly starting a transaction.

```javascript
const first = await pool.connect();
await first.query('BEGIN');
first.release(); // Deliberate omission in the experiment.

const next = await pool.connect();
await next.query('UPDATE pool_value SET value = 300 WHERE id = 1');
```

It is a new request to the application, but the database still sees the open transaction on the same connection. That connection read its own uncommitted write and returned 300. The separate observer returned 200. After `next` sent `ROLLBACK`, both connections read 200.

| Step | Reused connection | Separate connection |
| --- | --- | --- |
| Update to 300 inside the inherited transaction | 300 | 200 |
| Send `ROLLBACK` on that connection | 200 | 200 |

Seeing 300 in a query result did not prove that the write had committed. Repeatedly borrowing the writer's connection can make the update look saved, while borrowing another connection can make it look absent. The point where an update request reports success needs to be checked against the point where the database confirms the commit.

## When the write committed but the reader still sees the old value

Next, I left an old snapshot on the reader. It read the initial value 100 inside a `REPEATABLE READ` transaction and returned the connection without ending that transaction. The observer updated the value to 200 and committed. Then I borrowed the pooled connection again.

```javascript
const first = await pool.connect();
await first.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
await first.query('SELECT value FROM pool_value WHERE id = 1');
first.release();

await observer.query('UPDATE pool_value SET value = 200 WHERE id = 1');
const next = await pool.connect();
const result = await next.query('SELECT value FROM pool_value WHERE id = 1');
```

I compared `pg_backend_pid()` before release and after borrowing again to confirm that both borrowers used the same database session. The new borrower read 100; the observer read 200. After the reader ended its existing transaction with `ROLLBACK`, it read 200 too.

| Check | Observed result |
| --- | --- |
| Database session before and after release | Same session |
| Read through the reused connection | 100 |
| Read through the separate connection | 200 |
| Read through the reused connection after rollback | 200 |

In the previous experiment, the write was uncommitted. Here, it had already committed. Different simultaneous query results alone cannot distinguish them. We need to connect the transaction start and first read on one session with the write and commit on the other. PostgreSQL's `REPEATABLE READ` retains a transaction snapshot; its default `READ COMMITTED` obtains a new snapshot for each command. This experiment explicitly selected the former.

## Put cleanup around the callback

The original post says I added the missing transaction cleanup and checked rollback logs in local and development environments. For this new experiment, I wrapped the work in a function that ends the transaction whether the callback returns early or throws.

```javascript
async function withTransaction(work) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      discard = true;
      throw new AggregateError([error, rollbackError], 'Transaction cleanup failed');
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
```

Using the same driver, a callback updated the value to 400 and immediately returned. The separate connection then read 400. Another callback updated it to 500 and deliberately threw an exception; the separate connection still read 400. This checked commit on a normal return and rollback on an exception. All work used the `client` passed into the callback.

The code also discards the connection with `release(true)` if rollback itself fails. I did not inject a network failure or a lost commit response in this experiment. It does not establish the final outcome of such a commit or make retrying the business operation safe.

## Correcting the original explanation

The original post said that sending `START TRANSACTION` again rolls back the previous transaction. MariaDB and MySQL document an **implicit commit** of the existing transaction instead. That sentence cannot explain why a value disappeared in the original incident. Starting a new transaction is not a cleanup strategy: it could commit a previous borrower's unintended write.

I am not transferring every command's behavior from the PostgreSQL experiment to MariaDB either. The question they help examine is where the request ends, where the connection returns to the pool, and where the database transaction ends. When an update appears inconsistent, tracing the start, first read, write, and cleanup of each database session gives us more to work with than comparing values alone.

## Run the experiment

The [complete reproduction](/blog/examples/database-transactions.mjs) starts a temporary PostgreSQL server on a private Unix socket, then stops it and removes its data. It does not connect to an existing database or open a TCP port. I ran it with Node.js 24.15.0 on macOS arm64. The `pool` section of its output contains the results discussed here.

```bash
work="$(mktemp -d)"
npm install --prefix "$work" embedded-postgres@18.4.0-beta.17 pg@8.16.3
BLOG_DB_NODE_MODULES="$work/node_modules" node public/examples/database-transactions.mjs
```

If you downloaded the example separately, replace the final file path with its location. The runtime needs permission to use shared memory. The script prints the server and driver versions alongside its observations so you can check them when running it elsewhere.

## References

- [MysqlQueryRunner 0.3.26](https://github.com/typeorm/typeorm/blob/0.3.26/src/driver/mysql/MysqlQueryRunner.ts) (TypeORM): separate release and transaction-completion methods
- [PoolConnection 3.14.5](https://github.com/sidorares/node-mysql2/blob/v3.14.5/lib/base/pool_connection.js), [Pool 3.14.5](https://github.com/sidorares/node-mysql2/blob/v3.14.5/lib/base/pool.js) (mysql2): the default connection release path
- [Transactions](https://node-postgres.com/features/transactions) (node-postgres): using the same client to begin, query, and complete a transaction
- [Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html) (PostgreSQL 18): read isolation and snapshot lifetime
- [START TRANSACTION](https://mariadb.com/docs/server/reference/sql-statements/transactions/start-transaction) (MariaDB), [Implicit Commit](https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html) (MySQL 8.0): what starting another transaction does to the current one
