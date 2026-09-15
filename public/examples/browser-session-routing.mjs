/**
 * Independent local experiment. Node 24.15.0, playwright 1.56.1.
 * Copy this file to an empty directory, then:
 *   npm install --save-exact playwright@1.56.1
 *   npx playwright install chromium
 *   node browser-session-routing.mjs --self-test
 *   node browser-session-routing.mjs
 * Open http://127.0.0.1:47320 for the manual controls.
 * Only temporary browser contexts and a local mock login are used.
 */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const playwrightVersion = require('playwright/package.json').version;
assert.equal(playwrightVersion, '1.56.1', 'Use the pinned Playwright version.');
const { chromium } = await import('playwright');
const filename = fileURLToPath(import.meta.url);
const DEFAULT_TTL = 300_000;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 8192) throw new Error('Request too large');
  }
  return text ? JSON.parse(text) : {};
}

async function listen(handler, port = 0) {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => json(res, 500, { error: 'DEMO_ERROR' }));
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function closeServer(server) {
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await closed;
}

async function request(url, method = 'GET', data) {
  const response = await fetch(url, {
    method,
    headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() };
}

// This mock target knows about login cookies, but never saves the report draft.
async function startTarget() {
  const logins = new Set();
  return listen(async (req, res) => {
    const path = new URL(req.url, 'http://local').pathname;
    if (path === '/login' && req.method === 'POST') {
      const login = randomUUID();
      logins.add(login);
      res.writeHead(303, {
        'Set-Cookie': `demo_login=${login}; HttpOnly; SameSite=Lax; Path=/`,
        Location: '/workspace',
      });
      return res.end();
    }
    const login = /(?:^|;\s*)demo_login=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    if (path === '/workspace' && logins.has(login)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('<!doctype html><title>Demo workspace</title><h1>Signed in as demo</h1><label>Report draft<textarea aria-label="Report draft"></textarea></label><p>This draft exists only in this open page. Reloading clears it.</p>');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><title>Demo login</title><form action="/login" method="post"><button>Sign in as demo</button></form>');
  });
}

async function runWorker(name, targetUrl) {
  // This browser is the worker service's own resource, never a user browser/profile.
  const browser = await chromium.launch({ headless: true });
  const sessions = new Map();
  async function readSession(id) {
    const session = sessions.get(id);
    if (!session) return { status: 404, body: { error: 'SESSION_NOT_OWNED', worker: name } };
    return { status: 200, body: {
      worker: name,
      authenticated: await session.page.getByRole('heading', { name: 'Signed in as demo' }).isVisible(),
      page: new URL(session.page.url()).pathname,
      draft: await session.page.getByRole('textbox', { name: 'Report draft' }).inputValue(),
    } };
  }
  const service = await listen(async (req, res) => {
    const path = new URL(req.url, 'http://local').pathname;
    if (req.method === 'POST' && path === '/sessions') {
      const input = await body(req);
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(`${targetUrl}/login`);
        await page.getByRole('button', { name: 'Sign in as demo' }).click();
        await page.waitForURL(`${targetUrl}/workspace`);
        await page.getByRole('textbox', { name: 'Report draft' }).fill(input.draft);
        const sessionId = randomUUID();
        sessions.set(sessionId, { context, page });
        const snapshot = await readSession(sessionId);
        return json(res, 201, { sessionId, ...snapshot.body });
      } catch (error) {
        await context.close();
        throw error;
      }
    }
    if (req.method === 'GET' && path.startsWith('/sessions/')) {
      const snapshot = await readSession(path.slice('/sessions/'.length));
      return json(res, snapshot.status, snapshot.body);
    }
    json(res, 404, { error: 'NOT_FOUND' });
  });
  process.send({ ready: true, url: service.url, chromium: browser.version() });
  process.once('message', async message => {
    if (message !== 'stop') return;
    // The stop test closes the owner's browser as well as its HTTP service.
    await browser.close();
    await closeServer(service.server);
    process.exit(0);
  });
}

async function spawnWorker(name, targetUrl) {
  const child = fork(filename, ['worker', name, targetUrl], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const ready = await Promise.race([
    once(child, 'message').then(([message]) => message),
    once(child, 'exit').then(() => { throw new Error(`Worker ${name} exited before startup`); }),
  ]);
  return { name, child, ...ready };
}

async function stopWorker(worker) {
  if (worker.child.exitCode !== null) return;
  const exited = once(worker.child, 'exit');
  worker.child.send('stop');
  await exited;
}

const controlPage = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Browser session routing</title>
<style>body{font:16px system-ui;max-width:850px;margin:40px auto;padding:20px}button,input{font:inherit;margin:5px;padding:8px}pre{white-space:pre-wrap;background:#eee;padding:20px}label{display:block}</style>
<h1>Browser session routing</h1><p>A and B are separate Node processes, each with a dedicated headless browser. The target is a local mock login page.</p>
<label>Unsaved report draft <input id="draft" value="July report, step 2"></label>
<button id="create">1. Create session on A</button><button id="wrong">2. Send to B</button><button id="route">3. Route to owner</button>
<button id="expire">Expire mapping</button><button id="stop">Stop A and its browser</button><button id="remap">Point mapping to B</button>
<p>Create a new session after the expiry check, then stop A. Restart the script to restore A.</p><pre id="result" aria-live="polite">Ready</pre>
<script>
let sessionId;
for (const action of ['create','wrong','route','expire','stop','remap']) {
 document.getElementById(action).onclick=async()=>{
  try {
   const response=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,draft:document.getElementById('draft').value})});
   const data=await response.json(); if(data.sessionId) sessionId=data.sessionId;
   document.getElementById('result').textContent=JSON.stringify({action,status:response.status,...data},null,2);
  } catch(error) { document.getElementById('result').textContent=String(error); }
 };
}
</script></html>`;

async function startDemo(port) {
  const target = await startTarget();
  const workers = {};
  let router;
  try {
    workers.A = await spawnWorker('A', target.url);
    workers.B = await spawnWorker('B', target.url);
    // Only addresses and expiry times are shared here, never Page/context objects.
    const owners = new Map();
    router = await listen(async (req, res) => {
      const path = new URL(req.url, 'http://local').pathname;
      if (path === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(controlPage);
      }
      if (req.method !== 'POST' || !path.startsWith('/api/')) return json(res, 404, { error: 'NOT_FOUND' });
      const input = await body(req);
      const { sessionId } = input;
      if (path === '/api/create') {
        const created = await request(`${workers.A.url}/sessions`, 'POST', { draft: input.draft });
        owners.set(created.body.sessionId, { worker: 'A', expiresAt: Date.now() + (input.ttlMs ?? DEFAULT_TTL) });
        return json(res, created.status, created.body);
      }
      if (path === '/api/stop') {
        await stopWorker(workers.A);
        return json(res, 200, { stopped: 'A', browserClosed: true });
      }
      if (!sessionId) return json(res, 400, { error: 'SESSION_ID_REQUIRED' });
      const owner = owners.get(sessionId);
      if (path === '/api/expire') {
        if (!owner) return json(res, 404, { error: 'MAPPING_MISSING' });
        owner.expiresAt = Date.now() - 1;
        return json(res, 200, { mappingExpired: true, browserClosed: false });
      }
      if (path === '/api/remap') {
        owners.set(sessionId, { worker: 'B', expiresAt: Date.now() + DEFAULT_TTL });
        return json(res, 200, { owner: 'B', copiedBrowserState: false });
      }
      let destination;
      if (path === '/api/wrong') destination = workers.B;
      else if (path === '/api/route') {
        if (!owner) return json(res, 404, { error: 'MAPPING_MISSING' });
        if (owner.expiresAt <= Date.now()) return json(res, 410, { error: 'MAPPING_EXPIRED' });
        destination = workers[owner.worker];
      } else return json(res, 404, { error: 'NOT_FOUND' });
      try {
        const result = await request(`${destination.url}/sessions/${encodeURIComponent(sessionId)}`);
        return json(res, result.status, result.body);
      } catch {
        return json(res, 502, { error: 'OWNER_UNAVAILABLE', worker: destination.name });
      }
    }, port);
    return { router, workers, async close() {
      await closeServer(router.server);
      await Promise.all(Object.values(workers).map(stopWorker));
      await closeServer(target.server);
    } };
  } catch (error) {
    if (router) await closeServer(router.server);
    await Promise.all(Object.values(workers).map(stopWorker));
    await closeServer(target.server);
    throw error;
  }
}

async function selfTest(demo) {
  const api = (action, data) => request(`${demo.router.url}/api/${action}`, 'POST', data);
  const created = await api('create', { draft: 'July report, step 2' });
  assert.equal(created.status, 201);
  const sessionId = created.body.sessionId;
  assert.equal(created.body.authenticated, true);
  assert.equal(created.body.page, '/workspace');
  const wrong = await api('wrong', { sessionId });
  assert.equal(wrong.status, 404);
  assert.equal(wrong.body.error, 'SESSION_NOT_OWNED');
  console.log('WRONG_WORKER: 404 SESSION_NOT_OWNED');
  const routed = await api('route', { sessionId });
  assert.equal(routed.status, 200);
  assert.deepEqual(routed.body, { worker: 'A', authenticated: true, page: '/workspace', draft: 'July report, step 2' });
  console.log('OWNER: 200 authenticated=true draft="July report, step 2"');

  const short = await api('create', { draft: 'Expiry check', ttlMs: 50 });
  assert.equal(short.status, 201);
  await delay(75);
  const expired = await api('route', { sessionId: short.body.sessionId });
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error, 'MAPPING_EXPIRED');
  const stillOwned = await request(`${demo.workers.A.url}/sessions/${short.body.sessionId}`);
  assert.equal(stillOwned.status, 200);
  assert.equal(stillOwned.body.draft, 'Expiry check');
  console.log('EXPIRED_MAPPING: 410 MAPPING_EXPIRED; owner still reads the live Page');

  await api('stop', {});
  const stopped = await api('route', { sessionId });
  assert.equal(stopped.status, 502);
  assert.equal(stopped.body.error, 'OWNER_UNAVAILABLE');
  console.log('STOPPED_OWNER: 502 OWNER_UNAVAILABLE');
  await api('remap', { sessionId });
  const movedAddress = await api('route', { sessionId });
  assert.equal(movedAddress.status, 404);
  assert.equal(movedAddress.body.error, 'SESSION_NOT_OWNED');
  console.log('REMAPPED_TO_B: 404 SESSION_NOT_OWNED');
  const replacement = await request(`${demo.workers.B.url}/sessions`, 'POST', { draft: '' });
  assert.equal(replacement.status, 201);
  assert.equal(replacement.body.authenticated, true);
  assert.equal(replacement.body.draft, '');
  assert.notEqual(replacement.body.sessionId, sessionId);
  console.log('NEW_LOGIN_ON_B: 201 authenticated=true draft=""; new session');
  console.log('PASS: browser ownership, routing, mapping expiry, owner stop, address-only remap, new login');
}

if (process.argv[2] === 'worker') {
  await runWorker(process.argv[3], process.argv[4]);
} else {
  const testing = process.argv.includes('--self-test');
  const demo = await startDemo(testing ? 0 : Number(process.env.ROUTING_DEMO_PORT ?? 47320));
  console.log(`Node ${process.version}; Playwright ${playwrightVersion}; Chromium ${demo.workers.A.chromium}`);
  if (testing) {
    try { await selfTest(demo); } finally { await demo.close(); }
  } else {
    console.log(`Open ${demo.router.url}`);
    const shutdown = async () => { await demo.close(); process.exit(0); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
}
