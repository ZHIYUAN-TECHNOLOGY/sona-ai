import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { copyFor, easeOut, firstPhase, type LoaderState, MESSAGE_MS, messageAt, nextPhase, type Phase, REVEAL_MS, settled } from "@/lib/image-loader";
import { BAYER, compile, PALETTE } from "@/lib/sona-gl";
import "@/styles/image-loader.css";

type Tone = "film" | "paper";

// Sona's halftone as a loading field: Bayer-dithered dots on a small grid, lit by two layers of slow noise that drift
// past each other and swell like breath. `reveal` clears whole cells in dither order, so the dots resolve into the image
// beneath; `sweep` >= 0 instead draws a band of light dots running down an image a model is reading.
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 res;
uniform float t, pitch, reveal, sweep, level;
uniform vec3 ground, lo, hi;
out vec4 o;
${BAYER}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
float fbm(vec2 p) { return noise(p) * 0.6 + noise(p * 2.1 + 5.2) * 0.28 + noise(p * 4.3 - 3.7) * 0.12; }

void main() {
  vec2 p = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);
  vec2 idx = floor(p / pitch), cell = (idx + 0.5) * pitch;
  vec2 uv = cell / max(res.x, res.y) * 2.4;
  float th = bayer8(idx) * 0.86 + 0.07;
  // Round dots, kept crisp: one pixel on a 3 px grid, a small disc on a denser screen.
  float rad = pitch < 3.5 ? 0.62 : pitch * 0.25;
  float dotm = 1.0 - smoothstep(rad - 0.45, rad + 0.45, length(p - cell));
  vec3 col; float a;
  if (sweep < 0.0) {
    float n = fbm(uv + vec2(t * 0.045, -t * 0.03)) * 0.65 + fbm(uv * 0.55 - vec2(t * 0.02, t * 0.012) + 9.0) * 0.35;
    float lit = smoothstep(0.27, 0.74, n) * (0.88 + 0.12 * sin(t * 0.7)) * level;
    // The reveal: the ground fades as the image comes up beneath, and the dots go out cell by cell in dither order.
    float order = bayer8(idx + 3.0) * 0.6 + fbm(uv * 2.0) * 0.4;
    float on = step(th, lit) * dotm * step(reveal, order);
    float g = 1.0 - smoothstep(0.0, 0.75, reveal);
    col = mix(lo, hi, smoothstep(0.3, 0.75, lit)) * on + ground * g * (1.0 - on);
    a = on + g * (1.0 - on);
  } else {
    float d = cell.y / res.y - sweep;
    float band = d > 0.0 ? exp(-d * d / 0.0005) : exp(d / 0.1);
    float lit = band * (0.5 + 0.5 * fbm(uv * 1.6 + vec2(0.0, t * 0.15))) * level;
    a = step(th, lit) * dotm * 0.85;
    col = hi * a;
  }
  o = vec4(col, a);
}`;
const VERTEX = "#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";
const UNIFORMS = ["res", "t", "pitch", "reveal", "sweep", "level", "ground", "lo", "hi"] as const;
/** Ice on the film's dark ground; lilac to Sona blue on the light page. */
const TONES: Record<Tone, { ground: number[]; lo: number[]; hi: number[] }> = {
  film: { ground: [0.114, 0.122, 0.137], lo: [0.24, 0.47, 0.88], hi: [0.74, 0.9, 1.0] },
  paper: { ground: [0.961, 0.965, 0.973], lo: PALETTE.pro.hot, hi: PALETTE.pro.deep },
};
/** Where the field starts, so every still frame is the same, pleasing one. */
const T0 = 11;
const SWEEP_MS = 2600;
const FRAME_MS = 1000 / 60 - 4;

// One WebGL 2 context for every loader on the page (the orb keeps its own): each loader draws into the corner of a
// shared canvas that only grows, and copies its frame into its own 2D canvas. Released with the last loader drawing.
type Renderer = { gl: WebGL2RenderingContext; canvas: HTMLCanvasElement; at: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null> };
let shared: Renderer | null = null, users = 0, unsupported = false;

function acquire(): Renderer | null {
  if (unsupported || typeof document === "undefined") return null;
  if (!shared) {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
    const program = gl && compile(gl, VERTEX, FRAGMENT);
    if (!gl || !program) { unsupported = true; return null; }
    shared = { gl, canvas, at: Object.fromEntries(UNIFORMS.map(name => [name, gl.getUniformLocation(program, name)])) as Renderer["at"] };
  }
  users++;
  return shared;
}

function release() {
  if (--users > 0 || !shared) return;
  shared.gl.getExtension("WEBGL_lose_context")?.loseContext();
  shared = null;
}

/** Draws one w x h frame into the shared canvas and copies it to `ctx`. */
function paint({ gl, canvas, at }: Renderer, ctx: CanvasRenderingContext2D, w: number, h: number, pitch: number, tone: Tone, u: { t: number; reveal: number; sweep: number; level: number }) {
  if (canvas.width < w || canvas.height < h) { canvas.width = Math.max(canvas.width, w); canvas.height = Math.max(canvas.height, h); }
  gl.viewport(0, 0, w, h);
  const c = TONES[tone];
  gl.uniform3fv(at.ground, c.ground);
  gl.uniform3fv(at.lo, c.lo);
  gl.uniform3fv(at.hi, c.hi);
  gl.uniform2f(at.res, w, h);
  gl.uniform1f(at.pitch, pitch);
  gl.uniform1f(at.t, u.t);
  gl.uniform1f(at.reveal, u.reveal);
  gl.uniform1f(at.sweep, u.sweep);
  gl.uniform1f(at.level, u.level);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  ctx.clearRect(0, 0, w, h);
  // WebGL draws from the bottom-left corner.
  ctx.drawImage(canvas, 0, canvas.height - h, w, h, 0, 0, w, h);
}

// One frame loop for every loader: a job draws a frame and says whether it wants another. No jobs, no frames.
type Job = (now: number) => boolean;
const jobs = new Set<Job>();
let raf = 0, last = 0;
function tick(now: number) {
  raf = 0;
  if (now - last >= FRAME_MS) { last = now; for (const job of jobs) if (!job(now)) jobs.delete(job); }
  if (jobs.size) raf = requestAnimationFrame(tick);
}
const run = (job: Job) => { jobs.add(job); if (!raf) raf = requestAnimationFrame(tick); };

const density = () => Math.min(devicePixelRatio || 1, 2);

/** The status line, each character blurring in after the one before it. Words stay whole when it wraps. */
function Label({ text }: { text: string }) {
  let i = 0;
  return (
    <span className="il-label" aria-hidden="true">
      {text.split(" ").map((word, w) => (
        <span key={w}>{w ? " " : null}<span className="il-word">{Array.from(word, c => <span key={i} style={{ "--i": i++ } as CSSProperties}>{c}</span>)}</span></span>
      ))}
    </span>
  );
}

/**
 * A dynamically loaded or generated image, Sona's way: Sona's halftone dots drift and swell while it is pending, with
 * a status line top-left that moves on every 2.2 s; when the image decodes the dots resolve into it (about 600 ms, ease
 * out), then nothing draws. `reading`: the image is shown while a model reads it, a light scan running down it.
 * `failed`: a still field and "Film not available". Without `src` it is a placeholder (in a `fill` frame over a stage,
 * it dissolves to what is beneath when `ready`, then goes away). Paused off screen; a still frame under Reduce Motion;
 * a CSS dither without WebGL 2. `children` (finding marks) sit over the image.
 */
export function ImageLoader({ src, state: asked = "ready", messages, tone = "film", alt = "", fill, width, height, radius, className, children }: {
  src?: string; state?: LoaderState; messages?: string[]; tone?: Tone; alt?: string;
  /** Cover the positioned parent (a stage), above what it holds. */ fill?: boolean;
  width?: number | string; height?: number | string; radius?: number | string; className?: string; children?: ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const [from, setFrom] = useState(src);
  if (src !== from) { setFrom(src); setLoaded(false); setBroken(false); }
  const state: LoaderState = broken ? "failed" : asked;
  const has = !src || loaded;
  const [phase, setPhase] = useState<Phase>(() => firstPhase(state, has));
  const want = nextPhase(phase, state, has);
  if (want !== phase) setPhase(want);

  const copy = messages ?? copyFor(state, tone);
  const waiting = phase === "pending" || phase === "reading";
  const [at, setAt] = useState(0);
  const said = copy.join("\n");
  useEffect(() => {
    setAt(0);
    if (!waiting) return;
    const start = performance.now(), n = said.split("\n").length;
    const id = setInterval(() => { const next = messageAt(performance.now() - start, n); setAt(next); if (next === n - 1) clearInterval(id); }, MESSAGE_MS);
    return () => clearInterval(id);
  }, [said, waiting]);
  const label = phase === "failed" ? copy[0] : waiting ? copy[Math.min(at, copy.length - 1)] : undefined;

  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ phase, tone, state });
  const wake = useRef<() => void>(null);
  const [gl, setGl] = useState(true);
  const done = () => setPhase(p => (p === "reveal" ? settled(live.current.state) : p));

  useLayoutEffect(() => {
    live.current = { phase, tone, state };
    wake.current?.();
  }, [phase, tone, state]);

  const drawing = phase !== "visible";
  useLayoutEffect(() => {
    if (!drawing) return;
    const el = canvas.current, ctx = el?.getContext("2d"), renderer = el && ctx ? acquire() : null;
    if (!el || !ctx || !renderer) { setGl(false); return; }
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const scale = density(), pitch = scale < 1.5 ? 3 : 5;
    let w = 0, h = 0, onScreen = true, since = 0, seen: Phase | undefined;
    const job: Job = now => {
      const { phase, tone } = live.current;
      if (!onScreen || document.hidden || !w || !h || phase === "visible") return false;
      if (phase !== seen) { seen = phase; since = now; }
      const moving = !still.matches;
      let reveal = 0;
      if (phase === "reveal") {
        const x = moving ? (now - since) / REVEAL_MS : 1;
        if (x >= 1) { done(); return false; }
        reveal = easeOut(x);
      }
      const sweep = phase !== "reading" ? -1 : moving ? (((now - since) / SWEEP_MS) % 1) * 1.3 - 0.15 : 0.45;
      paint(renderer, ctx, w, h, pitch, tone, { t: moving ? T0 + now / 1000 : T0, reveal, sweep, level: phase === "failed" ? 0.55 : 1 });
      return moving && phase !== "failed";
    };
    const start = () => { if (job(performance.now())) run(job); };
    const measure = () => {
      const box = el.getBoundingClientRect();
      w = el.width = Math.round(box.width * scale);
      h = el.height = Math.round(box.height * scale);
      start();
    };
    wake.current = start;
    measure();
    const sized = new ResizeObserver(measure);
    sized.observe(el);
    const seenOnScreen = new IntersectionObserver(([entry]) => { onScreen = entry!.isIntersecting; start(); });
    seenOnScreen.observe(el);
    document.addEventListener("visibilitychange", start);
    still.addEventListener("change", start);
    return () => {
      jobs.delete(job);
      sized.disconnect();
      seenOnScreen.disconnect();
      document.removeEventListener("visibilitychange", start);
      still.removeEventListener("change", start);
      wake.current = null;
      release();
    };
  }, [drawing]);

  // Without WebGL 2 the CSS dither fades instead.
  useEffect(() => {
    if (gl || phase !== "reveal") return;
    const id = setTimeout(done, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : REVEAL_MS);
    return () => clearTimeout(id);
  }, [gl, phase]);

  // A placeholder over a stage has nothing left to show once it has dissolved.
  if (!src && !children && phase === "visible") return null;
  const busy = phase === "pending" || phase === "reveal" || phase === "reading";
  return (
    <div className={className ? `il ${className}` : "il"} data-tone={tone} data-phase={phase} data-fill={fill || undefined} data-gl={gl ? undefined : "off"}
      aria-busy={busy} role={src ? undefined : "img"} aria-label={src ? undefined : alt || copy[0]} style={{ width, height, borderRadius: radius }}>
      {src ? (
        <span className="il-media">
          <img src={src} alt={alt} draggable={false} onLoad={() => setLoaded(true)} onError={() => setBroken(true)} />
          {children}
        </span>
      ) : children}
      {drawing && (gl ? <canvas ref={canvas} className="il-canvas" aria-hidden="true" /> : <span className="il-canvas il-dither" aria-hidden="true" />)}
      {label ? phase === "failed" ? <span className="il-label" aria-hidden="true">{label}</span> : <Label key={label} text={label} /> : null}
    </div>
  );
}
