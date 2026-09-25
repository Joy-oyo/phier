import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, it, expect } from 'vitest';

function processor() {
  let Capture: any;
  const frames: { pcm: ArrayBuffer; rms: number }[] = [];
  runInNewContext(readFileSync('public/audio-worklet.js', 'utf8'), {
    AudioWorkletProcessor: class {
      port = {
        postMessage(value: { pcm: ArrayBuffer; rms: number }) {
          frames.push(value);
        },
      };
    },
    registerProcessor(_name: string, implementation: any) {
      Capture = implementation;
    },
  });
  return { node: new Capture(), frames };
}
describe('streaming PCM audio frames', () => {
  it('accumulates browser blocks into 480-sample, 20ms PCM16 frames', () => {
    const { node, frames } = processor();
    for (let i = 0; i < 3; i++) node.process([[new Float32Array(128).fill(0.5)]]);
    expect(frames).toHaveLength(0);
    node.process([[new Float32Array(128).fill(0.5)]]);
    expect(frames).toHaveLength(1);
    expect(frames[0].pcm.byteLength).toBe(960);
    expect(new Int16Array(frames[0].pcm)[0]).toBe(16383);
    expect(frames[0].rms).toBeCloseTo(0.5);
  });
  it('reports silence and clips out-of-range samples', () => {
    const { node, frames } = processor();
    node.process([[new Float32Array(480)]]);
    expect(frames[0].rms).toBe(0);
    const samples = new Float32Array(480).fill(2);
    samples[0] = -2;
    node.process([[samples]]);
    expect(new Int16Array(frames[1].pcm)[0]).toBe(-32768);
    expect(new Int16Array(frames[1].pcm)[1]).toBe(32767);
    expect(frames[1].rms).toBe(1);
  });
});
