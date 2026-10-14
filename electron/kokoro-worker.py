"""Intelligence's on-demand CPU worker. Only verified local assets are accepted."""
import base64
import json
import os
from pathlib import Path
import sys
import tempfile


def emit(value):
    print(json.dumps(value), flush=True)


def main():
    import numpy as np
    import onnxruntime as ort
    from kokoro_onnx import Kokoro
    from kokoro_onnx.chunker import split_phonemes
    from kokoro_onnx.config import EspeakConfig
    import espeakng_loader
    import ctypes

    os.environ.pop('PHONEMIZER_ESPEAK_LIBRARY', None)
    espeak = EspeakConfig(lib_path=espeakng_loader.get_library_path(),
                          data_path=espeakng_loader.get_data_path())
    ctypes.CDLL(espeak.lib_path)  # Fail before the wrapper could fall back to an unverified library.

    # Limit CPU use and release the process/model after the parent's short idle timeout.
    try:
        os.nice(5)
    except (AttributeError, OSError):
        pass
    model = None
    directory = None
    for line in sys.stdin:
        if len(line) > 100000:
            raise ValueError('Speech request exceeds limits')
        request = json.loads(line)
        session = request['session']
        text = request.get('text', '')
        voice = request.get('voice', 'af_heart')
        if not isinstance(text, str) or not text.strip() or len(text) > 12000:
            raise ValueError('Provide up to 12000 characters for speech')
        if voice not in ('af_heart', 'af_bella', 'am_michael'):
            raise ValueError('Choose a supported English voice')
        wanted = Path(request['modelDirectory'])
        if model is None:
            emit({'session': session, 'preparing': True})
            options = ort.SessionOptions()
            options.intra_op_num_threads = min(2, os.cpu_count() or 1)
            options.inter_op_num_threads = 1
            options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            options.add_session_config_entry('session.intra_op.allow_spinning', '0')
            options.add_session_config_entry('session.inter_op.allow_spinning', '0')
            inference = ort.InferenceSession(str(wanted/'model.onnx'), sess_options=options,
                                            providers=['CPUExecutionProvider'])
            voices = {}
            for name in ('af_heart', 'af_bella', 'am_michael'):
                # The pinned upstream .bin files are raw numeric float32, never pickle.
                values = np.fromfile(wanted/(name+'.bin'), dtype='<f4')
                if values.size != 510 * 256 or not np.isfinite(values).all():
                    raise ValueError('Invalid voice data; repair the model download')
                voices[name] = values.reshape(510, 1, 256)
            with tempfile.TemporaryDirectory(prefix='voice-cache-', dir=wanted) as temporary:
                packed = Path(temporary)/'voices.npz'
                np.savez(packed, **voices)
                model = Kokoro.from_session(inference, str(packed), espeak_config=espeak)
                model.voices.close()
                model.voices = voices
            directory = wanted
        elif wanted != directory:
            raise ValueError('Voice model directory changed')
        emit({'session': session, 'ready': True})
        # Public tokenizer/chunker keep punctuation/word boundaries within graph limits.
        phonemes = ' '.join(model.tokenizer.phonemize(text, 'en-us').split())
        batches = split_phonemes(phonemes, 200)
        if len(batches) > 1 and len(batches[-1]) < 20:
            batches[-2:] = [batches[-2] + ' ' + batches[-1]]
        if not batches:
            raise ValueError('No speech could be generated from this text')
        total = 0
        for index, batch in enumerate(batches):
            audio, rate = model.create(batch, voice=voice, lang='en-us', is_phonemes=True,
                                       trim=True)
            if not np.isfinite(audio).all():
                raise ValueError('Speech engine returned invalid audio')
            if index < len(batches)-1:
                audio = np.concatenate((audio, np.zeros(int(rate*0.2), dtype=np.float32)))
            raw = (np.clip(audio, -1, 1)*32767).astype('<i2').tobytes()
            total += len(raw)
            if total > 32*1024*1024:
                raise ValueError('Speech output exceeds limits')
            for offset in range(0, len(raw), 64000):
                emit({'session': session, 'audio': base64.b64encode(raw[offset:offset+64000]).decode(),
                      'sampleRate': rate})
                # Parent acknowledgement paces synthesis against playback, bounding queued audio.
                ack = sys.stdin.readline(4096)
                if not ack or json.loads(ack) != {'ack': session}:
                    raise ValueError('Speech session was interrupted')
        emit({'session': session, 'done': True})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit({'error': str(error)[:1000]})
        sys.exit(1)
