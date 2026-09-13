// Fictional, in-memory example for the blog. No credentials or network calls.
// Run: node backend-scope.mjs
import assert from 'node:assert/strict';

function failure(code) {
  return Object.assign(new Error(code), { code });
}

// context represents an authenticated user's saved choice, not model input.
function resolveBackend(context, settings) {
  if (!['personal', 'shared'].includes(context.mode)) {
    throw failure('INVALID_SCOPE');
  }
  if (context.mode === 'personal' && !context.userId) {
    throw failure('MISSING_USER');
  }
  const scope = context.mode === 'personal'
    ? `personal/${context.userId}`
    : 'shared';
  const config = settings.get(scope);
  if (!config) throw failure('NOT_CONFIGURED');
  if (config.status !== 'ready') throw failure('INVALID_CONFIG');
  return { scope, backend: config.backend };
}

async function execute(context, settings, invoke) {
  const target = resolveBackend(context, settings);
  return invoke(target); // Failure stays in the selected scope.
}

const settings = new Map([
  ['shared', { status: 'ready', backend: 'team-model' }],
  ['personal/alice', { status: 'ready', backend: 'alice-model' }],
  ['personal/bob', { status: 'ready', backend: 'bob-model' }],
  ['personal/invalid', { status: 'invalid', backend: 'broken-model' }],
]);
const calls = [];
const invoke = async (target) => {
  calls.push(target);
  return target.backend;
};

for (const [userId, code] of [
  ['missing', 'NOT_CONFIGURED'],
  ['invalid', 'INVALID_CONFIG'],
]) {
  await assert.rejects(
    execute({ mode: 'personal', userId }, settings, invoke),
    { code },
  );
}
assert.equal(calls.length, 0, 'bad settings must not invoke any backend');
await assert.rejects(
  execute({ mode: 'unknown' }, settings, invoke),
  { code: 'INVALID_SCOPE' },
);
await assert.rejects(
  execute({ mode: 'personal' }, settings, invoke),
  { code: 'MISSING_USER' },
);
assert.equal(calls.length, 0);

const alice = { mode: 'personal', userId: 'alice' };
await assert.rejects(execute(alice, settings, async (target) => {
  calls.push(target);
  throw failure('RATE_LIMITED'); // Simulated provider HTTP 429.
}), { code: 'RATE_LIMITED' });
assert.deepEqual(calls.map((target) => target.scope), ['personal/alice']);

assert.equal(await execute(alice, settings, invoke), 'alice-model');
assert.equal(await execute(
  { mode: 'personal', userId: 'bob' }, settings, invoke,
), 'bob-model');

settings.set('personal/invalid', { status: 'ready', backend: 'repaired-model' });
assert.equal(await execute(
  { mode: 'personal', userId: 'invalid' }, settings, invoke,
), 'repaired-model');
assert.equal(calls.some((target) => target.scope === 'shared'), false);

assert.equal(await execute({ mode: 'shared' }, settings, invoke), 'team-model');
assert.deepEqual(calls.at(-1), { scope: 'shared', backend: 'team-model' });
assert.equal(calls.filter((target) => target.scope === 'shared').length, 1);

console.log('PASS: missing, invalid, rate limit, user isolation, repair, explicit shared');
