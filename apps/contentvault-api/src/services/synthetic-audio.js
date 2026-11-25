/**
 * Deterministic synthetic WAV generator for ContentVault teaching audio companions.
 *
 * Produces a clean 16-bit mono PCM WAV buffer with gentle harmonic chime chords
 * unique to each chapter so standard browser <audio> playback, HTTP Range seeking,
 * and entitlement enforcement (CV-013) can be demonstrated without committing
 * large binary media files or copyrighted recordings to Git.
 */

const CHAPTER_CHORDS = [
  [261.63, 329.63, 392.0, 523.25], // Ch 1: C major
  [293.66, 349.23, 440.0, 587.33], // Ch 2: D minor
  [329.63, 392.0, 493.88, 659.25], // Ch 3: E minor
  [349.23, 440.0, 523.25, 659.25], // Ch 4: F major 7
  [392.0, 493.88, 587.33, 783.99], // Ch 5: G major
];

export function generateSyntheticTeachingWav({
  chapterOrdinal = 1,
  durationSeconds = 8,
  sampleRate = 22050,
} = {}) {
  const numSamples = Math.max(1, Math.floor(durationSeconds * sampleRate));
  const dataBytes = numSamples * 2; // 16-bit mono
  const buffer = Buffer.alloc(44 + dataBytes);

  // RIFF / WAVE header
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // AudioFormat = 1 (PCM)
  buffer.writeUInt16LE(1, 22); // NumChannels = 1 (mono)
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  buffer.writeUInt16LE(2, 32); // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);

  const chord = CHAPTER_CHORDS[(Math.max(1, chapterOrdinal) - 1) % CHAPTER_CHORDS.length];

  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    // Arpeggiated gentle notes every 1.6s + warm sustained pad
    const segment = Math.floor(t / 1.6);
    const localT = t - segment * 1.6;
    const noteFreq = chord[segment % chord.length];

    const attack = Math.min(1, localT / 0.04);
    const decay = Math.exp(-localT * 1.9);
    const noteEnv = attack * decay;

    const padEnv =
      Math.min(1, t / 0.25) *
      Math.min(1, (durationSeconds - t) / 0.4) *
      0.16;

    const chime =
      (Math.sin(2 * Math.PI * noteFreq * t) * 0.65 +
        Math.sin(2 * Math.PI * noteFreq * 2 * t) * 0.2) *
      noteEnv *
      0.42;

    const pad =
      (Math.sin(2 * Math.PI * chord[0] * t) +
        Math.sin(2 * Math.PI * chord[2] * t) * 0.7) *
      0.5 *
      padEnv;

    const sample = Math.max(-0.95, Math.min(0.95, chime + pad));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }

  return buffer;
}
