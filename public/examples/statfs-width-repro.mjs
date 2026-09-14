// Run with Node.js 24.15.0 on macOS arm64, with Bun 1.3.14 and clang on PATH.
// Uses real fs.statfsSync bindings with synthetic native statfs responses.
// No EFS access, mounts, global installation, or modification of Bun/Node.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// This example's native fixture defines 4096 bytes per counted block.
// Do not infer a quota or EFS storage budget from the resulting total.
function availableBytes(stats) {
  const { bsize, blocks, bfree, bavail } = stats;
  if ([bsize, blocks, bfree, bavail].some(v => typeof v !== 'bigint')) {
    throw new TypeError('Read statfs with bigint: true before doing arithmetic');
  }
  if (bsize <= 0n || blocks <= 0n || bfree < 0n || bavail < 0n
      || bfree > blocks || bavail > bfree) {
    return { kind: 'unknown' };
  }
  return { kind: 'measured', bytes: bavail * bsize };
}

if (process.argv[2] === '--probe') {
  const small = statfsSync('/__statfs_width_fixture__');
  const big = statfsSync('/__statfs_width_fixture__', { bigint: true });
  console.log(JSON.stringify({ small, big }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
} else {
  assert.equal(process.platform, 'darwin', 'This native fixture is macOS only');
  assert.equal(process.arch, 'arm64', 'The tested native fixture is macOS arm64 only');
  assert.equal(process.versions.node, '24.15.0', 'Run this pinned comparison with Node.js 24.15.0');
  const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { encoding: 'utf8', ...options });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, `${command} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  const bunRevision = run('bun', ['--revision']);
  assert.equal(bunRevision, '1.3.14+0d9b296af', 'This reproducer expects the affected Bun build');
  const dir = mkdtempSync(join(tmpdir(), 'statfs-width-'));
  try {
    const library = join(dir, 'statfs-width-shim.dylib');
    const source = fileURLToPath(new URL('./statfs-width-shim.c', import.meta.url));
    const script = fileURLToPath(import.meta.url);
    run('clang', ['-dynamiclib', '-Wall', '-Wextra', '-Werror', source, '-o', library]);
    const cases = [
      ['small', [1000000n, 750000n, 749000n], [1000000, 750000, 749000]],
      ['signed-edge', [2n ** 31n + 20n, 2n ** 31n, 2n ** 31n], [-2147483628, -2147483648, -2147483648]],
      ['large', [2n ** 43n, 2n ** 43n - 7n, 2n ** 43n - 9n], [0, -7, -9]],
      ['positive-wrap', [2n ** 32n + 20n, 2n ** 32n + 10n, 2n ** 32n + 9n], [20, 10, 9]],
    ];
    console.log(`Bun ${bunRevision}; Node ${process.versions.node}; ${process.platform} ${process.arch}`);
    for (const [name, expected, wrapped] of cases) {
      // Scope interposition to these child processes; never change the shell environment.
      const env = { ...process.env, DYLD_INSERT_LIBRARIES: library, STATFS_BLOG_CASE: name };
      const bun = JSON.parse(run('bun', [script, '--probe'], { env }));
      const node = JSON.parse(run(process.execPath, [script, '--probe'], { env }));
      for (const sample of [bun, node]) {
        assert.equal(sample.small.type, 12345, 'Native fixture was not loaded');
        assert.equal(sample.big.type, '12345', 'Native fixture was not loaded');
        assert.equal(sample.small.bsize, 4096);
        assert.equal(sample.big.bsize, '4096');
        assert.deepEqual(['blocks', 'bfree', 'bavail'].map(k => sample.big[k]), expected.map(String));
      }
      assert.deepEqual(['blocks', 'bfree', 'bavail'].map(k => bun.small[k]), wrapped);
      assert.deepEqual(['blocks', 'bfree', 'bavail'].map(k => node.small[k]), expected.map(Number));
      const corrected = Object.fromEntries(Object.entries(bun.big).map(([k, v]) => [k, BigInt(v)]));
      assert.deepEqual(availableBytes(corrected), { kind: 'measured', bytes: expected[2] * 4096n });
      const floor = 10n * 4096n; // A synthetic 40 KiB threshold, not an operating policy.
      assert.equal(availableBytes(corrected).bytes < floor, false);
      console.log(`${name}: Bun number=[${wrapped.join(', ')}]; Bun bigint / Node=[${expected.join(', ')}]; corrected low=false`);
      if (name === 'positive-wrap') {
        assert.equal(bun.small.bavail * bun.small.bsize < Number(floor), true);
        console.log('positive-wrap: old low=true even though the returned fields are nonnegative');
      }
    }
    const valid = { bsize: 4096n, blocks: 100n, bfree: 20n, bavail: 10n };
    for (const stats of [{ ...valid, bsize: 0n }, { ...valid, bavail: -1n }, { ...valid, bavail: 21n }]) {
      assert.deepEqual(availableBytes(stats), { kind: 'unknown' });
    }
    assert.throws(() => availableBytes({ ...valid, bavail: 10 }), TypeError);
    assert.deepEqual(availableBytes({ ...valid, bavail: 0n }), { kind: 'measured', bytes: 0n });
    assert.equal((2n ** 43n) * 4096n, 32n * 1024n ** 5n); // 32 PiB, not 8 EiB.
    assert.equal((2n ** 43n) * (2n ** 20n), 8n * 1024n ** 6n); // With a 1 MiB unit: 8 EiB.
    console.log('PASS: native conversion, bigint workaround, validation, and byte units');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
