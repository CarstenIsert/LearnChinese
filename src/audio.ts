/**
 * Web Audio pipeline for Gemini Multimodal Live API:
 * - Captures microphone audio at 16kHz, 16-bit mono PCM (base64 encoded chunks)
 * - Plays back streaming 24kHz, 16-bit mono PCM chunks gaplessly with interruption support
 * - Exposes live volume level (0..1) for the voice visualizer
 */

export class LiveAudioManager {
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private nextPlayTime = 0;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private isMuted = false;

  public onAudioInputChunk?: (base64Pcm16k: string) => void;
  public onVolumeChange?: (micLevel: number, aiSpeaking: boolean) => void;

  async startMicrophone(): Promise<void> {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.inputContext = new AudioContext({ sampleRate: 16000 });
    this.outputContext = new AudioContext({ sampleRate: 24000 });

    this.sourceNode = this.inputContext.createMediaStreamSource(this.mediaStream);
    this.processorNode = this.inputContext.createScriptProcessor(4096, 1, 1);

    this.processorNode.onaudioprocess = (event) => {
      const float32Data = event.inputBuffer.getChannelData(0);

      // Compute RMS volume for visualizer
      let sum = 0;
      for (let i = 0; i < float32Data.length; i++) {
        sum += float32Data[i] * float32Data[i];
      }
      const rms = Math.sqrt(sum / float32Data.length);
      const normalizedVolume = Math.min(1, rms * 5);
      this.onVolumeChange?.(this.isMuted ? 0 : normalizedVolume, this.activeSources.size > 0);

      if (this.isMuted) return;

      // Convert Float32 (-1..1) to Int16 PCM
      const int16Buffer = new Int16Array(float32Data.length);
      for (let i = 0; i < float32Data.length; i++) {
        const clamped = Math.max(-1, Math.min(1, float32Data[i]));
        int16Buffer[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }

      const base64 = arrayBufferToBase64(int16Buffer.buffer);
      this.onAudioInputChunk?.(base64);
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.inputContext.destination);
  }

  setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  playPcm24kChunk(base64Data: string) {
    if (!this.outputContext) {
      this.outputContext = new AudioContext({ sampleRate: 24000 });
    }
    if (this.outputContext.state === 'suspended') {
      this.outputContext.resume();
    }

    const rawBytes = base64ToUint8Array(base64Data);
    const int16Array = new Int16Array(
      rawBytes.buffer,
      rawBytes.byteOffset,
      Math.floor(rawBytes.byteLength / 2)
    );
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    const audioBuffer = this.outputContext.createBuffer(1, float32Array.length, 24000);
    audioBuffer.getChannelData(0).set(float32Array);

    const source = this.outputContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputContext.destination);

    const now = this.outputContext.currentTime;
    if (this.nextPlayTime < now) {
      this.nextPlayTime = now + 0.02;
    }

    source.start(this.nextPlayTime);
    this.nextPlayTime += audioBuffer.duration;
    this.activeSources.add(source);
    this.onVolumeChange?.(0, true);

    source.onended = () => {
      this.activeSources.delete(source);
      this.onVolumeChange?.(0, this.activeSources.size > 0);
    };
  }

  interruptPlayback() {
    for (const src of this.activeSources) {
      try {
        src.stop();
      } catch {
        // ignore
      }
    }
    this.activeSources.clear();
    if (this.outputContext) {
      this.nextPlayTime = this.outputContext.currentTime;
    }
    this.onVolumeChange?.(0, false);
  }

  stopAll() {
    this.interruptPlayback();
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.inputContext) {
      this.inputContext.close().catch(() => {});
      this.inputContext = null;
    }
    if (this.outputContext) {
      this.outputContext.close().catch(() => {});
      this.outputContext = null;
    }
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
