import fs from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
export async function extractDocument(file, signal) {
  if ((await fs.stat(file)).size > 25 * 1024 * 1024) throw Error('Choose a document up to 25 MB');
  const bytes = await fs.readFile(file);
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./matrix-file-worker.mjs', import.meta.url), {
      workerData: { bytes, extension: path.extname(file).toLowerCase() },
      resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    let finished = false;
    const finish = (error, text) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      error ? reject(error) : resolve(text);
    };
    const abort = () => finish(signal.reason || Error('Stopped'));
    const timer = setTimeout(
      () => finish(Error('Document extraction timed out; provide a smaller file')),
      25000,
    );
    worker.once('message', (result) =>
      finish(result.error ? Error(result.error) : null, result.text),
    );
    worker.once('error', (e) => finish(e));
    worker.once('exit', (code) => {
      if (!finished) finish(Error('Document extractor exited: ' + code));
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
