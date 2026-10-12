const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadDemo } = require('./demo-test-helpers.cjs');
const manifest = require('./action-manifest.json');

test('every prototype action has an implementation, acceptance owner or explicit scope decision', () => {
  const root = path.resolve(__dirname,'..');
  const source = fs.readFileSync(path.join(root,'docs/demo.html'),'utf8');
  // Some handlers are registered after the DOM listener boundary used by business tests.
  const late = [...source.matchAll(/actions\['([^']+)'\]\s*=/g)].map(match=>match[1]);
  const actual = [...new Set([...Object.keys(loadDemo().actions),...late])].sort();
  const listed = manifest.map(item=>item.id).sort();
  assert.equal(new Set(listed).size,listed.length,'Duplicate inventory entries');
  assert.deepEqual(listed,actual,'A prototype action is missing from the acceptance inventory');
  for (const item of manifest) {
    assert.ok(['mapped_evidence_review','browser_verified','unverified_microphone_per_user','excluded_desktop_scope'].includes(item.status));
    if (item.status === 'excluded_desktop_scope') continue;
    assert.ok(fs.existsSync(path.join(root,item.implementation)),item.id+' implementation missing');
    assert.ok(fs.existsSync(path.join(root,item.test.split(':')[0])),item.id+' acceptance owner missing');
    if (item.status === 'browser_verified') {
      assert.ok(item.cases.normal.length > 0,item.id+' normal case missing');
      assert.ok(item.cases.alternate.length > 0,item.id+' failure or boundary case missing');
      assert.ok(item.evidence.some(file=>file.endsWith('control-cases.json')),item.id+' observed outcomes missing');
    }
  }
});
