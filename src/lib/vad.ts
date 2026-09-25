export class VoiceDetector {
  speaking = false;
  private voiceMs = 0;
  private quietMs = 0;
  private turnMs = 0;
  constructor(
    public silenceMs = 850,
    public threshold = 0.018,
  ) {}
  reset() {
    this.speaking = false;
    this.voiceMs = 0;
    this.quietMs = 0;
    this.turnMs = 0;
  }
  consume(rms: number, durationMs: number): 'start' | 'end' | null {
    if (rms >= this.threshold) {
      this.voiceMs += durationMs;
      this.quietMs = 0;
    } else {
      this.quietMs += durationMs;
      if (!this.speaking) this.voiceMs = 0;
    }
    if (!this.speaking && this.voiceMs >= 100) {
      this.speaking = true;
      this.turnMs = this.voiceMs;
      return 'start';
    }
    if (this.speaking) {
      this.turnMs += durationMs;
      if (this.quietMs >= this.silenceMs || this.turnMs >= 30_000) {
        this.reset();
        return 'end';
      }
    }
    return null;
  }
}
