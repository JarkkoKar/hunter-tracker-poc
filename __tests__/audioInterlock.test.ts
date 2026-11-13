import { describe, it, expect } from '@jest/globals';
import {
  AudioWarningLevel,
  AUDIO_WARNING_TONES,
  DEFAULT_AUDIO_COOLDOWN_MS,
  DEFAULT_AUDIO_REMINDER_MS,
  createAudioInterlockState,
  setAudioWarningEnabled,
  shouldPlayAudioWarning,
  generateToneWav,
  bytesToBase64,
  buildToneFileName,
  getToneDurationMs,
  AudioInterlockState,
} from '../src/utils/audioInterlock';
import { RadioTxMode } from '../src/utils/emconState';

// Node-ajonaikainen Buffer riippumattomana vertailukohtana base64-koodaukselle
declare const Buffer: { from(bytes: Uint8Array): { toString(encoding: 'base64'): string } };

/** Ajaa tapahtumasarjan ja palauttaa soitetut tasot aikaleimoineen. */
function run(
  events: Array<{ t: number; danger: boolean }>,
  initial: AudioInterlockState = createAudioInterlockState()
) {
  let state = initial;
  const played: Array<{ t: number; level: AudioWarningLevel }> = [];
  for (const e of events) {
    const d = shouldPlayAudioWarning(state, { isDanger: e.danger, nowMs: e.t });
    state = d.state;
    if (d.play && d.level) played.push({ t: e.t, level: d.level });
  }
  return { played, state };
}

describe('Oletusasetukset', () => {
  it('päällä oletuksena, cooldown 2500 ms, muistutus 10 s', () => {
    const s = createAudioInterlockState();
    expect(s.enabled).toBe(true);
    expect(s.cooldownMs).toBe(2500);
    expect(DEFAULT_AUDIO_COOLDOWN_MS).toBe(2500);
    expect(DEFAULT_AUDIO_REMINDER_MS).toBe(10_000);
    expect(s.lastAlertAt).toBeNull();
  });
});

describe('shouldPlayAudioWarning: hälytyspäätös', () => {
  it('turvallinen -> vaara soittaa kaksoispiippauksen (DANGER_SECTOR_ENTER)', () => {
    const { played } = run([
      { t: 0, danger: false },
      { t: 100, danger: true },
    ]);
    expect(played).toEqual([{ t: 100, level: AudioWarningLevel.DANGER_SECTOR_ENTER }]);
  });

  it('turvallisena pysyminen ei soita mitään', () => {
    const { played } = run([0, 500, 5000, 20000].map((t) => ({ t, danger: false })));
    expect(played).toEqual([]);
  });

  it('vaarassa pysyminen ei toista hälytystä jatkuvasti (vain muistutus 10 s välein)', () => {
    const events = [];
    for (let t = 0; t <= 25_000; t += 250) events.push({ t, danger: true });
    const { played } = run(events);
    expect(played.map((p) => p.level)).toEqual([
      AudioWarningLevel.DANGER_SECTOR_ENTER,
      AudioWarningLevel.DANGER_REMINDER,
      AudioWarningLevel.DANGER_REMINDER,
    ]);
    expect(played.map((p) => p.t)).toEqual([0, 10_000, 20_000]);
  });

  it('kompassin heiluminen rajalla: enintään yksi ääni / 2.5 s', () => {
    const events = [];
    for (let t = 0; t <= 6000; t += 200) events.push({ t, danger: (t / 200) % 2 === 0 });
    const { played } = run(events);
    for (let i = 1; i < played.length; i++) {
      expect(played[i].t - played[i - 1].t).toBeGreaterThanOrEqual(2500);
    }
    expect(played.length).toBeGreaterThanOrEqual(2);
    expect(played.every((p) => p.level === AudioWarningLevel.DANGER_SECTOR_ENTER)).toBe(true);
  });

  it('hystereesi: uusi tuloääni vaatii poistumisen turvalliselle sektorille', () => {
    const { played } = run([
      { t: 0, danger: true }, // ääni
      { t: 3000, danger: true }, // edelleen vaarassa: ei uutta tuloääntä
      { t: 4000, danger: false }, // poistuu -> virittyy
      { t: 4500, danger: true }, // ääni (cooldown ohi)
    ]);
    expect(played).toEqual([
      { t: 0, level: AudioWarningLevel.DANGER_SECTOR_ENTER },
      { t: 4500, level: AudioWarningLevel.DANGER_SECTOR_ENTER },
    ]);
  });

  it('cooldownin aikana tullut vaara soitetaan, kun ajastin nollautuu ja vaara jatkuu', () => {
    const { played } = run([
      { t: 0, danger: true }, // ääni
      { t: 500, danger: false },
      { t: 1000, danger: true }, // cooldown kesken: ei ääntä, pysyy viritettynä
      { t: 2000, danger: true },
      { t: 2600, danger: true }, // cooldown ohi -> ääni
    ]);
    expect(played.map((p) => p.t)).toEqual([0, 2600]);
  });

  it('kytkin pois päältä estää kaikki äänet', () => {
    const off = setAudioWarningEnabled(createAudioInterlockState(), false);
    const events = [];
    for (let t = 0; t <= 30_000; t += 500) events.push({ t, danger: t % 3000 < 1500 });
    expect(run(events, off).played).toEqual([]);
  });

  it('kytkimen päälle laitto kesken vaaran soittaa tuloäänen', () => {
    let s = setAudioWarningEnabled(createAudioInterlockState(), false);
    s = shouldPlayAudioWarning(s, { isDanger: true, nowMs: 0 }).state;
    s = setAudioWarningEnabled(s, true);
    const d = shouldPlayAudioWarning(s, { isDanger: true, nowMs: 100 });
    expect(d.play).toBe(true);
    expect(d.level).toBe(AudioWarningLevel.DANGER_SECTOR_ENTER);
  });

  it('EMCON RX_ONLY ei estä paikallista äänivaroitusta (ei RF-lähetystä)', () => {
    for (const radioMode of [RadioTxMode.NORMAL, RadioTxMode.BURST_MANUAL, RadioTxMode.RX_ONLY]) {
      const d = shouldPlayAudioWarning(createAudioInterlockState(), {
        isDanger: true,
        nowMs: 1000,
        radioMode,
      });
      expect(d.play).toBe(true);
    }
  });

  it('päätös ei muuta syötettyä tilaa (immutable)', () => {
    const s = createAudioInterlockState();
    shouldPlayAudioWarning(s, { isDanger: true, nowMs: 1 });
    expect(s.lastAlertAt).toBeNull();
    expect(s.armed).toBe(true);
  });
});

describe('Merkkiäänet: matala ja lyhyt, ei peitä ympäristön ääniä', () => {
  it('tulo = kaksoispiippaus, muistutus = yksi piippaus', () => {
    expect(AUDIO_WARNING_TONES[AudioWarningLevel.DANGER_SECTOR_ENTER].beepCount).toBe(2);
    expect(AUDIO_WARNING_TONES[AudioWarningLevel.DANGER_REMINDER].beepCount).toBe(1);
  });

  it.each(Object.values(AudioWarningLevel))('%s: taajuus ≤ 1000 Hz, kesto < 400 ms, voimakkuus ≤ 0.7', (level) => {
    const tone = AUDIO_WARNING_TONES[level];
    expect(tone.frequencyHz).toBeLessThanOrEqual(1000);
    expect(tone.frequencyHz).toBeGreaterThanOrEqual(300);
    expect(getToneDurationMs(tone)).toBeLessThan(400);
    expect(tone.volume).toBeGreaterThan(0);
    expect(tone.volume).toBeLessThanOrEqual(0.7);
  });

  it('tiedostonimet ovat yksilöllisiä ja versioituja', () => {
    const names = Object.values(AudioWarningLevel).map(buildToneFileName);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^huntertracker_[a-z_]+_v\d+\.wav$/);
  });
});

describe('generateToneWav: 16-bit mono PCM WAV', () => {
  const SR = 22050;
  const tone = AUDIO_WARNING_TONES[AudioWarningLevel.DANGER_SECTOR_ENTER];
  const wav = generateToneWav(tone, SR);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
  const sample = (i: number) => view.getInt16(44 + i * 2, true);
  const sampleCount = (wav.byteLength - 44) / 2;

  it('RIFF/WAVE-otsake ja fmt-kenttä', () => {
    expect(ascii(0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
    expect(ascii(8)).toBe('WAVE');
    expect(ascii(12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(SR);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(wav.byteLength - 44);
  });

  it('kesto vastaa piippauksia ja taukoja', () => {
    expect(sampleCount).toBe(Math.round((getToneDurationMs(tone) * SR) / 1000));
  });

  it('piippausten välinen tauko on hiljaa, piippaukset eivät', () => {
    const beepEnd = Math.round((tone.beepMs * SR) / 1000);
    const gapEnd = Math.round(((tone.beepMs + tone.gapMs) * SR) / 1000);
    for (let i = beepEnd + 2; i < gapEnd - 2; i++) expect(sample(i)).toBe(0);
    const mid = Math.round(beepEnd / 2);
    let maxAbs = 0;
    for (let i = mid - 50; i < mid + 50; i++) maxAbs = Math.max(maxAbs, Math.abs(sample(i)));
    expect(maxAbs).toBeGreaterThan(0.9 * tone.volume * 32767);
  });

  it('huippu ei ylitä voimakkuutta (ei leikkautumista) ja alku/loppu häivytetään (ei naksahdusta)', () => {
    let peak = 0;
    for (let i = 0; i < sampleCount; i++) peak = Math.max(peak, Math.abs(sample(i)));
    expect(peak).toBeLessThanOrEqual(Math.ceil(tone.volume * 32767));
    expect(Math.abs(sample(0))).toBeLessThan(200);
    expect(Math.abs(sample(sampleCount - 1))).toBeLessThan(200);
  });

  it('taajuus: nollanylitysten määrä ensimmäisessä piippauksessa ≈ 2 × f × kesto', () => {
    const beepEnd = Math.round((tone.beepMs * SR) / 1000);
    let crossings = 0;
    for (let i = 1; i < beepEnd; i++) {
      if ((sample(i - 1) < 0 && sample(i) >= 0) || (sample(i - 1) >= 0 && sample(i) < 0)) crossings++;
    }
    const expected = (2 * tone.frequencyHz * tone.beepMs) / 1000;
    expect(Math.abs(crossings - expected)).toBeLessThanOrEqual(3);
  });
});

describe('bytesToBase64 (tiedoston kirjoitus expo-file-systemillä)', () => {
  it.each([0, 1, 2, 3, 4, 5, 255, 1000])('vastaa Node Bufferia, pituus %i', (len) => {
    const bytes = new Uint8Array(len).map((_, i) => (i * 37 + 11) & 0xff);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('koko WAV-tiedosto koodautuu oikein', () => {
    const wav = generateToneWav(AUDIO_WARNING_TONES[AudioWarningLevel.DANGER_REMINDER]);
    expect(bytesToBase64(wav)).toBe(Buffer.from(wav).toString('base64'));
  });
});
