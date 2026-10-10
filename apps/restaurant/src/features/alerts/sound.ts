// New-order sound, made with Web Audio so there's no file to load. Browsers keep audio locked until
// someone taps or types on the page, so the app has to ask for one tap and say so honestly.

let ctx: AudioContext | null = null;

export const audioRunning = () => ctx?.state === "running";

/** Call from a tap or key press. Resolves true once the browser lets us play sound. */
export async function unlockAudio(): Promise<boolean> {
  try {
    ctx ??= new AudioContext();
    if (ctx.state !== "running") await ctx.resume();
  } catch {
    return false;
  }
  return ctx.state === "running";
}

/** One bright tone with a quick attack and a soft tail, so it cuts through a noisy kitchen. */
function tone(at: number, freq: number, length: number, volume: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

/** Rising three-note ring for a new order, played twice. Returns false if audio is still locked. */
export function playNewOrder(): boolean {
  if (!ctx || ctx.state !== "running") return false;
  const t = ctx.currentTime + 0.05;
  for (const offset of [0, 0.75]) {
    tone(t + offset, 880, 0.22, 0.5);
    tone(t + offset + 0.16, 1175, 0.22, 0.5);
    tone(t + offset + 0.32, 1568, 0.4, 0.55);
  }
  return true;
}

/** Short soft chime to confirm sound works after turning it on. */
export function playCheck(): void {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime + 0.05;
  tone(t, 1175, 0.18, 0.3);
  tone(t + 0.14, 1568, 0.3, 0.3);
}
