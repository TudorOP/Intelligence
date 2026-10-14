import path from 'node:path';
export const embeddingModel = 'Xenova/bge-small-en-v1.5';
async function createPipeline({ cacheDir, progress_callback }) {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  env.allowRemoteModels = true;
  env.backends.onnx.wasm.numThreads = 2;
  return pipeline('feature-extraction', embeddingModel, {
    device: 'cpu',
    dtype: 'q8',
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    progress_callback,
  });
}
export class Memory {
  constructor(store, emit, runtime = {}) {
    this.store = store;
    this.emit = emit;
    this.pipeline = null;
    this.loading = null;
    this.indexing = null;
    this.indexAgain = false;
    this.generation = 0;
    this.closed = false;
    this.embeddings = new Set();
    this.createPipeline = runtime.createPipeline ?? createPipeline;
    this.retryAt = 0;
    this.status = 'CPU semantic search prepares automatically on first use';
  }
  async enable() {
    if (this.closed) return;
    if (this.loading) return this.loading;
    if (this.pipeline) return;
    const generation = this.generation;
    this.loading = (async () => {
      this.status = 'Preparing the CPU memory model · downloads automatically if needed…';
      this.emit({ type: 'memory', status: this.status });
      const pipeline = await this.createPipeline({
        cacheDir: path.join(this.store.directory, 'models'),
        progress_callback: (p) => {
          if (p.status === 'progress' && generation === this.generation && !this.closed) {
            this.emit({
              type: 'memory',
              status: `Preparing memory model · ${Math.round(p.progress ?? 0)}%`,
            });
          }
        },
      });
      if (generation !== this.generation || this.closed) {
        await pipeline.dispose?.();
        return;
      }
      this.pipeline = pipeline;
      this.store.setSettings({ embeddingEnabled: true });
      await this.index({ foreground: true });
      if (generation !== this.generation || this.closed) return;
      this.status = 'Semantic + keyword search ready';
      this.emit({ type: 'memory', status: this.status });
    })()
      .catch(async (e) => {
        if (generation !== this.generation || this.closed) return;
        await this.release();
        this.retryAt = Date.now() + 60000;
        this.status =
          'Keyword search ready · CPU model unavailable; retries on later use. ' + e.message;
        this.emit({ type: 'memory', status: this.status });
        throw e;
      })
      .finally(() => (this.loading = null));
    return this.loading;
  }
  async embed(text) {
    const pipeline = this.pipeline;
    if (!pipeline) return null;
    const job = { pipeline, promise: null };
    job.promise = Promise.resolve().then(() =>
      pipeline(text.slice(0, 6000), { pooling: 'cls', normalize: true }),
    );
    this.embeddings.add(job);
    try {
      const output = await job.promise;
      return Array.from(output.data);
    } finally {
      this.embeddings.delete(job);
    }
  }
  async index({ foreground = false } = {}) {
    if (this.store.settings().backgroundPaused && !foreground) return;
    if (!this.pipeline || this.store.settings().semanticSearch === false) return;
    this.indexAgain = true;
    if (this.indexing) return this.indexing;
    const generation = this.generation;
    this.indexing = (async () => {
      do {
        this.indexAgain = false;
        const indexed = new Set(this.store.vectorIds(embeddingModel));
        for (const e of this.store.all(false,true)
          .filter((e) => ['memory', 'note'].includes(e.kind) && this.store.access(e.id))) {
          if (generation !== this.generation || this.closed || !this.pipeline) return;
          if (!indexed.has(e.id)) {
            const vector = await this.embed(e.title + '\n' + (e.data.content ?? ''));
            if (generation !== this.generation || this.closed || !vector) return;
            this.store.vector(e.id, embeddingModel, vector, e.revision);
          }
        }
      } while (this.indexAgain && generation === this.generation);
    })().finally(() => (this.indexing = null));
    return this.indexing;
  }
  async release() {
    this.generation++;
    const pipeline = this.pipeline;
    this.pipeline = null;
    this.indexAgain = false;
    this.status = 'Keyword search ready';
    if (!this.closed) this.emit({ type: 'memory', status: this.status });
    await Promise.allSettled(
      [...this.embeddings].filter((j) => j.pipeline === pipeline).map((j) => j.promise),
    );
    await pipeline?.dispose?.();
    this.status = 'Keyword search ready';
  }
  async close() {
    this.closed = true;
    await this.release();
    await this.loading?.catch(() => {});
  }
  async search(query, { project, limit = 8, kind } = {}) {
    const lexical = this.store
      .search(query, { agent: true, project, limit: 30, kind })
      .filter((e) => ['note', 'memory'].includes(e.kind));
    if (this.closed || !String(query).trim() || this.store.settings().semanticSearch === false)
      return lexical.slice(0, limit);
    // Keep chat usable during an uncached download or offline retry.
    if (!this.pipeline && Date.now() >= this.retryAt) void this.enable().catch(() => {});
    if (!this.pipeline || this.loading) return lexical.slice(0, limit);
    try {
      await this.index({ foreground: true });
      const vector = await this.embed(
        'Represent this sentence for searching relevant passages: ' + query,
      );
      if (!vector || this.closed || this.store.settings().semanticSearch === false)
        return lexical.slice(0, limit);
      const semantic = this.store
        .vectors(embeddingModel)
        .filter((v) => this.store.access(v.id) && (!kind || this.store.get(v.id)?.kind === kind))
        .map((v) => ({
          entity: this.store.get(v.id),
          score: v.vector.reduce((sum, n, i) => sum + n * (vector[i] ?? 0), 0),
        }))
        .filter(
          (v) =>
            !project ||
            v.entity.project === project ||
            (v.entity.kind === 'memory' && !v.entity.project),
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, 30);
      const scores = new Map();
      lexical.forEach((e, i) => scores.set(e.id, { ...e, score: 1 / (60 + i) }));
      semantic.forEach((v, i) => {
        const prior = scores.get(v.entity.id);
        scores.set(v.entity.id, { ...v.entity, score: (prior?.score ?? 0) + 1 / (60 + i) });
      });
      return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    } catch (error) {
      await this.release();
      this.retryAt = Date.now() + 60000;
      this.status =
        'Keyword search ready · CPU search unavailable; retries on later use. ' + error.message;
      this.emit({ type: 'memory', status: this.status });
      return lexical.slice(0, limit);
    }
  }
}
