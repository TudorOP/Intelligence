import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOccurrence } from '../electron/schedule.mjs';
test('a recurring card advances to its next future occurrence rather than replaying missed runs', () => {
  assert.equal(
    nextOccurrence(
      { start: '2026-10-01T09:00:00Z', repeat: 'daily' },
      new Date('2026-10-07T10:00:00Z'),
    ),
    '2026-10-08T09:00:00.000Z',
  );
  assert.equal(
    nextOccurrence(
      { start: '2026-10-01T09:00:00Z', repeat: 'weekly' },
      new Date('2026-10-07T10:00:00Z'),
    ),
    '2026-10-08T09:00:00.000Z',
  );
  assert.equal(nextOccurrence({ start: '2026-10-01T09:00:00Z', repeat: 'none' }), null);
});
