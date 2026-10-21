import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from '../src/lib/rules/runChecks';

test('all runChecks() pass', async () => {
  const results = await runChecks();
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${String(r.id).padStart(2)} ${r.name} — ${r.detail}`);
  assert.equal(results.filter((r) => !r.pass).length, 0);
  assert.ok(results.length >= 15);
});
