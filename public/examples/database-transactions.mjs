// Run with Node.js and dependencies installed in a disposable directory:
// npm install --prefix "$work" embedded-postgres@18.4.0-beta.17 pg@8.16.3
// BLOG_DB_NODE_MODULES="$work/node_modules" node database-transactions.mjs
// This starts a real, temporary PostgreSQL server on a private Unix socket.
// It does not connect to an existing database or listen on a TCP port.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const modules = process.env.BLOG_DB_NODE_MODULES;
assert(modules, 'Set BLOG_DB_NODE_MODULES to the disposable node_modules directory.');
const require = createRequire(join(resolve(modules), '__blog_repro__.cjs'));
const { default: EmbeddedPostgres } = await import(pathToFileURL(require.resolve('embedded-postgres')).href);
const { Pool, Client } = require('pg');
const temporary = await mkdtemp(join(tmpdir(), 'blog-db-'));
const socket = join(temporary, 'socket');
await mkdir(socket, { mode: 0o700 });
const password = randomBytes(24).toString('hex');
const server = new EmbeddedPostgres({
  databaseDir: join(temporary, 'data'),
  user: 'blog_repro', password, authMethod: 'scram-sha-256',
  port: 5432, persistent: false, createPostgresUser: false,
  postgresFlags: ['-c', 'listen_addresses=', '-c', `unix_socket_directories=${socket}`],
  onLog: () => {}, onError: () => {},
});
const config = { host: socket, port: 5432, user: 'blog_repro', password, database: 'postgres', connectionTimeoutMillis: 5000 };
const clients = [];
let pool;
let started = false;
async function connection() {
  const client = new Client(config);
  await client.connect();
  await client.query("SET statement_timeout = '5s'");
  clients.push(client);
  return client;
}
const readValue = async (client) => Number((await client.query('SELECT value FROM pool_value WHERE id = 1')).rows[0].value);

// A callback return is still a successful transaction. A rollback failure
// discards the connection instead of giving it to the next pool borrower.
async function withTransaction(work) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); }
    catch (rollbackError) {
      discard = true;
      throw new AggregateError([error, rollbackError], 'Transaction cleanup failed');
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

async function poolCases(observer) {
  await observer.query('CREATE TABLE pool_value (id integer PRIMARY KEY, value integer NOT NULL)');
  await observer.query('INSERT INTO pool_value VALUES (1, 100)');
  pool = new Pool({ ...config, max: 1, idleTimeoutMillis: 0 });
  const first = await pool.connect();
  await first.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const firstPid = (await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  assert.equal(await readValue(first), 100); // Establish the snapshot.
  first.release(); // Intentionally omit COMMIT and ROLLBACK.

  await observer.query('UPDATE pool_value SET value = 200 WHERE id = 1');
  const borrowed = await pool.connect();
  const nextPid = (await borrowed.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const snapshot = {
    sameBackend: firstPid === nextPid,
    reusedRead: await readValue(borrowed),
    independentRead: await readValue(observer),
  };
  assert.deepEqual(snapshot, { sameBackend: true, reusedRead: 100, independentRead: 200 });
  await borrowed.query('ROLLBACK');
  snapshot.afterRollback = await readValue(borrowed);
  assert.equal(snapshot.afterRollback, 200);
  borrowed.release();

  const leaker = await pool.connect();
  await leaker.query('BEGIN');
  leaker.release();
  const writer = await pool.connect();
  await writer.query('UPDATE pool_value SET value = 300 WHERE id = 1');
  const uncommitted = { reusedRead: await readValue(writer), independentRead: await readValue(observer) };
  assert.deepEqual(uncommitted, { reusedRead: 300, independentRead: 200 });
  await writer.query('ROLLBACK');
  uncommitted.afterRollback = await readValue(writer);
  assert.equal(uncommitted.afterRollback, 200);
  writer.release();

  const returned = await withTransaction(async (client) => {
    await client.query('UPDATE pool_value SET value = 400 WHERE id = 1');
    return 'early-return';
  });
  assert.equal(returned, 'early-return');
  assert.equal(await readValue(observer), 400);
  const injected = new Error('deliberate callback failure');
  await assert.rejects(withTransaction(async (client) => {
    await client.query('UPDATE pool_value SET value = 500 WHERE id = 1');
    throw injected;
  }), (error) => error === injected);
  assert.equal(await readValue(observer), 400);
  return { snapshot, uncommitted, callbackBoundary: { afterReturn: 400, afterException: 400 } };
}

const firstSlot = ['2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z'];
const overlappingSlot = ['2030-01-01T10:30:00Z', '2030-01-01T11:30:00Z'];
const insert = (table) => `INSERT INTO ${table} (resource_id, starts_at, ends_at) VALUES ($1, $2, $3)`;
const overlap = (table) => `SELECT count(*)::integer AS count FROM ${table}
  WHERE resource_id = $1 AND starts_at < $3::timestamptz AND ends_at > $2::timestamptz`;

async function race(observer, table, mode) {
  // Table names come only from the fixed cases below, never user input.
  await observer.query(`CREATE TABLE ${table} (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    resource_id integer NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    CHECK (starts_at < ends_at)
    ${mode === 'unique' ? ', UNIQUE (resource_id, starts_at, ends_at)' : ''}
    ${mode === 'exclude' ? ", EXCLUDE USING gist (resource_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)" : ''}
  )`);
  const a = await connection();
  const b = await connection();
  await a.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await b.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  const counts = await Promise.all([
    a.query(overlap(table), [1, ...firstSlot]),
    b.query(overlap(table), [1, ...overlappingSlot]),
  ]);
  const checked = counts.map((result) => result.rows[0].count);
  assert.deepEqual(checked, [0, 0]);
  await a.query(insert(table), [1, ...firstSlot]);

  let secondOutcome;
  let confirmedBlocked = false;
  if (mode === 'exclude') {
    const aPid = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const pending = b.query(insert(table), [1, ...overlappingSlot])
      .then(() => 'inserted', (error) => error.code);
    for (let attempts = 0; attempts < 100; attempts++) {
      const result = await observer.query('SELECT $1::integer = ANY(pg_blocking_pids($2)) AS blocked', [aPid, bPid]);
      if (result.rows[0].blocked) { confirmedBlocked = true; break; }
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert(confirmedBlocked, 'Did not observe B waiting for A; do not report the race as verified.');
    await a.query('COMMIT');
    secondOutcome = await pending;
    assert.equal(secondOutcome, '23P01');
    await b.query('ROLLBACK');
  } else {
    await b.query(insert(table), [1, ...overlappingSlot]);
    await b.query('COMMIT');
    await a.query('COMMIT');
    secondOutcome = 'committed';
  }
  const rows = (await observer.query(`SELECT count(*)::integer AS count FROM ${table}`)).rows[0].count;
  assert.equal(rows, mode === 'exclude' ? 1 : 2);
  const result = { bothChecks: checked, secondOutcome, rows };
  if (mode === 'exclude') result.confirmedBlocked = confirmedBlocked;
  if (mode === 'unique') {
    await assert.rejects(observer.query(insert(table), [1, ...firstSlot]), (error) => error.code === '23505');
    result.identicalRange = '23505';
  }
  return result;
}

try {
  await server.initialise();
  await server.start();
  started = true;
  const observer = await connection();
  const version = (await observer.query('SHOW server_version')).rows[0].server_version;
  await observer.query('CREATE EXTENSION btree_gist');
  const poolResults = await poolCases(observer);
  const reservations = {};
  for (const mode of ['none', 'unique', 'exclude']) {
    reservations[mode] = await race(observer, `reservation_${mode}`, mode);
  }
  await observer.query(insert('reservation_exclude'), [1, '2030-01-01T11:00:00Z', '2030-01-01T12:00:00Z']);
  await observer.query(insert('reservation_exclude'), [2, ...overlappingSlot]);
  await assert.rejects(observer.query(insert('reservation_exclude'), [1, firstSlot[0], firstSlot[0]]), (error) => error.code === '23514');
  reservations.boundaries = { adjacentAccepted: true, otherResourceAccepted: true, emptyRange: '23514' };
  console.log(JSON.stringify({ server: `PostgreSQL ${version}`, driver: `pg ${require('pg/package.json').version}`, pool: poolResults, reservations }, null, 2));
} finally {
  if (pool) await pool.end();
  await Promise.allSettled(clients.map((client) => client.end()));
  if (started) await server.stop();
  await rm(temporary, { recursive: true, force: true });
}
