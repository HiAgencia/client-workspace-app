import { describe, expect, it } from "vitest";
import { encodeWav, isSupportedWav, mixToMono, resample, SAMPLE_RATE } from "./wav";

describe("voice note encoding", () => {
  it("writes a mono 16-bit PCM WAV at 24 kHz that the server accepts", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]));
    expect(wav.length).toBe(44 + 10);
    expect(isSupportedWav(wav)).toBe(true);
    const view = new DataView(wav.buffer);
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(view.getInt16(44 + 3 * 2, true)).toBe(0x7fff);
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-0x8000);
  });

  it("refuses what is not mono 16-bit PCM at 16 or 24 kHz", () => {
    const stereo = encodeWav(new Float32Array(4));
    new DataView(stereo.buffer).setUint16(22, 2, true);
    expect(isSupportedWav(stereo)).toBe(false);
    const rate = encodeWav(new Float32Array(4), 44_100);
    expect(isSupportedWav(rate)).toBe(false);
    expect(isSupportedWav(new TextEncoder().encode("not a wav file at all, just some text bytes here"))).toBe(false);
  });

  it("resamples 48 kHz to 24 kHz and mixes channels to mono", () => {
    expect(resample(new Float32Array(48_000), 48_000).length).toBe(24_000);
    expect(Array.from(mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([0.5, 0.5]);
  });
});
