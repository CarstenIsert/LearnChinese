/**
 * Web Audio pipeline for Gemini Multimodal Live API:
 * - Captures microphone audio at 16kHz, 16-bit mono PCM (base64 encoded chunks)
 * - Plays back streaming 24kHz, 16-bit mono PCM chunks gaplessly with interruption support
 * - Exposes live volume level (0..1) for the voice visualizer
 */

const WORKLET_PROCESSOR_NAME = 'pcm-capture-processor';

export class LiveAudioManager {
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private nextPlayTime = 0;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private isMuted = false;
  private stopped = false;

  public onAudioInputChunk?: (base64Pcm16k: string) => void;
  public onVolumeChange?: (micLevel: number, aiSpeaking: boolean) => void;

  async startMicrophone(): Promise<void> {
    this.stopped = false;
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    if (this.stopped) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
      return;
    }

    this.inputContext = new AudioContext({ sampleRate: 16000 });
    this.outputContext = new AudioContext({ sampleRate: 24000 });

    if (this.inputContext.state === 'suspended') {
      await this.inputContext.resume();
    }

    await this.inputContext.audioWorklet.addModule(
      `${import.meta.env.BASE_URL}pcm-capture-processor.js`
    );

    if (this.stopped || !this.inputContext || !this.mediaStream) {
      return;
    }

    this.sourceNode = this.inputContext.createMediaStreamSource(this.mediaStream);
    this.workletNode = new AudioWorkletNode(this.inputContext, WORKLET_PROCESSOR_NAME);

    this.workletNode.port.onmessage = (
      event: MessageEvent<{ pcmBuffer: ArrayBuffer; rms: number }>
    ) => {
      const { pcmBuffer, rms } = event.data;
      const normalizedVolume = Math.min(1, rms * 5);
      this.onVolumeChange?.(this.isMuted ? 0 : normalizedVolume, this.activeSources.size > 0);

      if (this.isMuted) return;

      const base64 = arrayBufferToBase64(pcmBuffer);
      this.onAudioInputChunk?.(base64);
    };

    this.sourceNode.connect(this.workletNode);
  }

  setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  playPcm24kChunk(base64Data: string) {
    if (!this.outputContext) {
      this.outputContext = new AudioContext({ sampleRate: 24000 });
    }
    if (this.outputContext.state === 'suspended') {
      this.outputContext.resume().catch(() => {});
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
    this.stopped = true;
    this.interruptPlayback();
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
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
  const chunkSize = 0x4000;
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
