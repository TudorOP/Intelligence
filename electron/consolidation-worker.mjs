import os from 'node:os';
import {
  ensureSummaryModel,
  consolidationSchema,
  consolidationInstruction,
} from './memory-model.mjs';

if (process.platform !== 'linux') throw new Error('MiniCPM5 consolidation runs in the Linux app');
let model,
  llama,
  runtime,
  processing = false;
const controller = new AbortController();
process.on('disconnect', () => {
  controller.abort();
  process.exit(0);
});
process.on('message', async (job) => {
  if (processing || job?.type !== 'summarize') return;
  processing = true;
  let context, completion;
  try {
    if (!model) {
      const modelPath = await ensureSummaryModel(job.directory, {
        signal: controller.signal,
        progress: (status) => process.send?.({ type: 'status', status }),
      });
      process.send?.({ type: 'status', status: 'Loading MiniCPM5 on CPU…' });
      runtime = await import('node-llama-cpp');
      const threads = Math.max(1, Math.min(2, os.availableParallelism() - 1));
      llama = await runtime.getLlama({
        gpu: false,
        build: 'never',
        skipDownload: true,
        maxThreads: threads,
      });
      model = await llama.loadModel({ modelPath, gpuLayers: 0, loadSignal: controller.signal });
    }
    process.send?.({ type: 'status', status: 'Consolidating conversation · MiniCPM5 on CPU' });
    context = await model.createContext({ contextSize: 8192, sequences: 1, threads: 2 });
    completion = new runtime.LlamaCompletion({ contextSequence: context.getSequence() });
    const grammar = await llama.createGrammarForJsonSchema(consolidationSchema);
    // MiniCPM5's official ChatML/no-think template; user data is tokenized WITHOUT special tokens.
    const tokens = [
      ...model.tokenize('BOS', 'builtin'),
      ...model.tokenize('<|im_start|>system\n', true),
      ...model.tokenize(consolidationInstruction, false),
      ...model.tokenize('<|im_end|>\n<|im_start|>user\n', true),
      ...model.tokenize(JSON.stringify(job.transcript), false),
      ...model.tokenize('<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n', true),
    ];
    if (tokens.length > 7100)
      throw new Error('Conversation batch exceeds the memory context budget');
    const output = await completion.generateCompletion(tokens, {
      grammar,
      maxTokens: 900,
      temperature: 0,
      signal: controller.signal,
      disableContextShift: true,
      customStopTriggers: ['<|im_end|>'],
    });
    process.send?.({ type: 'result', output: JSON.parse(output) });
  } catch (e) {
    process.send?.({ type: 'error', error: e.message });
  } finally {
    completion?.dispose();
    await context?.dispose();
    processing = false;
  }
});
