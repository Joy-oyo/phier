// Runs off the UI thread. PCM frames are transferred, never written to storage.
class PhierCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(480);
    this.index = 0;
    this.energy = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const sample of channel) {
      const value = Math.max(-1, Math.min(1, sample));
      this.frame[this.index++] = value < 0 ? value * 32768 : value * 32767;
      this.energy += value * value;
      if (this.index === 480) {
        this.port.postMessage({ pcm: this.frame.buffer, rms: Math.sqrt(this.energy / 480) }, [
          this.frame.buffer,
        ]);
        this.frame = new Int16Array(480);
        this.index = 0;
        this.energy = 0;
      }
    }
    return true;
  }
}
registerProcessor('phier-capture', PhierCapture);
