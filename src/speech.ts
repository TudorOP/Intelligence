import { api } from './api';
let playback: AudioContext | null = null,
  sources: AudioBufferSourceNode[] = [],
  nextAudio = 0,
  unsubscribePlayback: (() => void) | null = null,
  playbackGeneration = 0;
let activeSession = '',
  releasePlayback: (() => void) | null = null;
let playbackStatus: ((state: string) => void) | null = null;
export function stopPlayback() {
  resetPlayback(true);
}
function resetPlayback(stopEngine: boolean) {
  const session = activeSession;
  activeSession = '';
  releasePlayback?.();
  releasePlayback = null;
  playbackStatus?.('');
  playbackStatus = null;
  playbackGeneration++;
  unsubscribePlayback?.();
  unsubscribePlayback = null;
  for (const source of sources)
    try {
      source.stop();
    } catch {}
  sources = [];
  nextAudio = 0;
  void playback?.close();
  playback = null;
  if (stopEngine && session)
    void api.workspace({ action: 'module-stop', id: 'tts', session }).catch(() => {});
}
export async function speak(
  text: string,
  onError: (error: any) => void,
  onState?: (state: string) => void,
) {
  resetPlayback(true);
  const generation = playbackGeneration;
  playbackStatus = onState || null;
  playbackStatus?.('Preparing voice…');
  try {
    playback = new AudioContext();
    await playback.resume();
    if (generation !== playbackGeneration) return;
    // Bound synthesis and PCM residency while retaining every part of long replies.
    text = speechText(text);
    if (!text.trim()) throw Error('No readable text in this response');
    for (const chunk of speechChunks(text)) {
      if (generation !== playbackGeneration) return;
      await playChunk(chunk, generation, onError);
    }
    if (generation === playbackGeneration) resetPlayback(false);
  } catch (e) {
    if (generation !== playbackGeneration) return;
    stopPlayback();
    throw e;
  }
}
export function speechText(text: string) {
  return text
    .replace(/```[^\n]*\n[\s\S]*?```/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_`~]/g, '');
}
export function speechChunks(text: string) {
  const chunks: string[] = [];
  while (text.length > 1000) {
    const window = text.slice(0, 1000);
    let at = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf(' '));
    if (at < 300) at = 999;
    chunks.push(text.slice(0, at + 1));
    text = text.slice(at + 1);
  }
  if (text) chunks.push(text);
  return chunks;
}
async function playChunk(text: string, generation: number, onError: (error: any) => void) {
  let session = '',
    finished = false,
    bytes = 0;
  const drained = new Promise<void>((resolve) => {
    releasePlayback = resolve;
  });
  const pending: any[] = [];
  const handle = (event: any) => {
    if (!session) {
      if (event.type === 'module-speech' && event.module === 'tts') pending.push(event);
      return;
    }
    if (
      generation !== playbackGeneration ||
      event.type !== 'module-speech' ||
      event.session !== session
    )
      return;
    if (event.cancelled) {
      stopPlayback();
      return;
    }
    if (event.error) {
      onError(event.error);
      stopPlayback();
      return;
    }
    try {
      if (event.audio && playback) {
        playbackStatus?.('Speaking…');
        const raw = atob(event.audio);
        bytes += raw.length;
        if (
          bytes > 32 * 1024 ** 2 ||
          raw.length % 2 ||
          !Number.isFinite(event.sampleRate) ||
          event.sampleRate < 8000 ||
          event.sampleRate > 96000
        )
          throw Error('Invalid speech audio');
        const buffer = playback.createBuffer(1, raw.length / 2, event.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          let sample = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
          if (sample > 32767) sample -= 65536;
          data[i] = sample / 32768;
        }
        const source = playback.createBufferSource();
        source.buffer = buffer;
        source.connect(playback.destination);
        const start = Math.max(playback.currentTime + 0.03, nextAudio);
        nextAudio = start + buffer.duration;
        sources.push(source);
        source.onended = () => {
          source.disconnect();
          if (generation !== playbackGeneration) return;
          sources = sources.filter((s) => s !== source);
          if (finished && !sources.length) {
            releasePlayback?.();
          }
        };
        source.start(start);
      }
      if (event.done) {
        finished = true;
        unlisten();
        unsubscribePlayback = null;
        if (!sources.length) {
          releasePlayback?.();
        }
      }
    } catch (e) {
      onError(e);
      stopPlayback();
    }
  };
  const unlisten = api.onEvent(handle);
  unsubscribePlayback = unlisten;
  try {
    const result = await api.workspace({ action: 'module-speak', id: 'tts', text });
    if (generation !== playbackGeneration) {
      void api
        .workspace({ action: 'module-stop', id: 'tts', session: result.session })
        .catch(() => {});
      return;
    }
    if (!result.session) throw Error('Speech engine did not return a session');
    session = result.session;
    activeSession = session;
    for (const event of pending) handle(event);
    pending.length = 0;
    await drained;
    if (generation === playbackGeneration) {
      activeSession = '';
      releasePlayback = null;
    }
  } catch (e) {
    unlisten();
    if (generation !== playbackGeneration) return;
    throw e;
  }
}
export async function dictate(
  onText: (text: string, final: boolean) => void,
  onError: (error: any) => void,
  onStopped: () => void = () => {},
) {
  const result = await api.workspace({ action: 'module-listen', id: 'stt' }),
    session = result.session;
  let stream: MediaStream | null = null,
    context: AudioContext | null = null,
    processor: ScriptProcessorNode | null = null,
    source: MediaStreamAudioSourceNode | null = null,
    stopped = false;
  const unlisten = api.onEvent((event: any) => {
    if (event.type !== 'module-speech' || event.session !== session) return;
    if (event.transcript !== undefined) onText(event.transcript, !!event.final);
    if (event.error) onError(event.error);
    if (event.error || event.done) {
      unlisten();
      void cleanup(false);
    }
  });
  async function cleanup(finish = true) {
    if (stopped) {
      if (!finish) unlisten();
      return;
    }
    stopped = true;
    onStopped();
    processor?.disconnect();
    source?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    await context?.close();
    if (finish)
      await api.workspace({ action: 'module-listen-finish', session }).catch((e) => {
        unlisten();
        onError(e);
      });
    else {
      unlisten();
      await api.workspace({ action: 'module-stop', id: 'stt', session }).catch(() => {});
    }
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true },
      video: false,
    });
    if (stopped) {
      stream.getTracks().forEach((t) => t.stop());
      throw Error('Speech session stopped');
    }
    context = new AudioContext();
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    const rate = context.sampleRate;
    processor.onaudioprocess = (e) => {
      if (stopped) return;
      const input = e.inputBuffer.getChannelData(0),
        length = Math.floor((input.length * 16000) / rate),
        bytes = new Uint8Array(length * 2),
        view = new DataView(bytes.buffer);
      for (let i = 0; i < length; i++) {
        const at = (i * rate) / 16000,
          base = Math.floor(at),
          fraction = at - base;
        const sample = (input[base] || 0) * (1 - fraction) + (input[base + 1] || 0) * fraction;
        view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
      }
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      void api
        .workspace({ action: 'module-listen-push', session, audio: btoa(binary) })
        .catch((e) => {
          onError(e);
          void cleanup(false);
        });
    };
    source.connect(processor);
    processor.connect(context.destination);
    await context.resume();
    return cleanup;
  } catch (e) {
    await cleanup(false);
    throw e;
  }
}
