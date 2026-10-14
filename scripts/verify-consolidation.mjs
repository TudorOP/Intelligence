import assert from 'node:assert/strict';
import { MiniCPMRunner, validateConsolidation } from '../electron/consolidation.mjs';
if (process.platform !== 'linux') throw new Error('Run the real MiniCPM5 smoke test on Linux');
const runner = new MiniCPMRunner('.test-data/consolidation', console.log);
const transcript = [
  {
    id: 'user:0',
    messageId: 'user',
    role: 'user',
    content: 'I prefer the dark theme. My main Linux distribution is CachyOS.',
  },
  {
    id: 'assistant:0',
    messageId: 'assistant',
    role: 'assistant',
    content: 'You prefer dark mode and mainly use CachyOS.',
  },
];
try {
  const result = validateConsolidation(
    await runner.run(transcript, AbortSignal.timeout(600000)),
    transcript,
  );
  assert.ok(result.summary.length > 10);
  assert.ok(result.facts.length > 0, 'Expected at least one evidence-backed user fact');
  assert.ok(result.facts.every((f) => f.messageIds[0] === 'user'));
  console.log('MiniCPM5 CPU generation and evidence validation passed.');
} finally {
  runner.close();
}
