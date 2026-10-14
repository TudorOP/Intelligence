import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseLabel, nextRelease } from '../electron/release-version.mjs';
test('release labels advance by one hundredth while packages remain valid semantic versions', () => {
  assert.equal(releaseLabel('0.9.0'), '0.9');
  assert.equal(nextRelease('0.9.0'), '0.9.1');
  assert.equal(releaseLabel(nextRelease('0.9.0')), '0.91');
  assert.equal(releaseLabel(nextRelease('0.9.1')), '0.92');
  assert.equal(nextRelease('0.9.9'), '1.0.0');
  assert.equal(releaseLabel(nextRelease('1.0.0')), '1.01');
  assert.throws(() => releaseLabel('invalid'));
});
