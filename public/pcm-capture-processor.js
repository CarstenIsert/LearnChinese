class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) {
      return true;
    }

    let inputOffset = 0;
    while (inputOffset < input.length) {
      const remaining = this.bufferSize - this.offset;
      const toCopy = Math.min(remaining, input.length - inputOffset);
      this.buffer.set(input.subarray(inputOffset, inputOffset + toCopy), this.offset);
      this.offset += toCopy;
      inputOffset += toCopy;

      if (this.offset >= this.bufferSize) {
        let sum = 0;
        const int16 = new Int16Array(this.bufferSize);
        for (let i = 0; i < this.bufferSize; i++) {
          const sample = this.buffer[i];
          sum += sample * sample;
          const clamped = Math.max(-1, Math.min(1, sample));
          int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        }
        const rms = Math.sqrt(sum / this.bufferSize);
        this.port.postMessage({ pcmBuffer: int16.buffer, rms }, [int16.buffer]);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
