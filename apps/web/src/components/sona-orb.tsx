import { type ButtonHTMLAttributes, useEffect, useLayoutEffect, useRef, useState } from "react";

import { BAYER, compile, PALETTE } from "@/lib/sona-gl";
import { BLOOM_MS, LOOK, type Look, moving, orbState, type OrbState, step } from "@/lib/sona-orb";
import "@/styles/sona-orb.css";

type App = "pro" | "care";

// The iPhone's Aurora core orb (apps/native/components/sona/glass-orb.tsx) in GLSL: a clear glass sphere holding a
// halftone aurora (Bayer-dithered dots, as in sona-glow) that curls around its inside; a fixed window highlight, a
// crescent reflection, a bright rim and a faint cool iridescence. `energy` raises and brightens the aurora, `ang` turns
// it round the glass, `bloom` is the answered flash. y runs down, as on the phone.
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 res;
uniform float t, ang, energy, bloom, pitch;
uniform vec3 deep, mid, hot;
out vec4 o;
${BAYER}
const vec3 ICE = vec3(0.3, 0.76, 0.9);

// Light of the aurora at uv, and how far above its crest uv is.
vec2 aurora(vec2 uv) {
  float c = cos(ang), s = sin(ang);
  vec2 v = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
  float crest = 0.3 - 0.32 * energy + 0.13 * sin(v.x * 3.0 + t * 0.8);
  float dd = v.y - crest;
  float folds = pow(0.5 + 0.5 * sin(v.x * 9.0 + sin(v.x * 3.0 + t * 0.5) * 1.5 + t * 0.4), 1.4);
  // Rays rise from the crest; below it a soft pool of colour settles to the bottom of the glass.
  float curtain = dd < 0.0 ? exp(dd / (0.46 + 0.22 * energy)) * (0.25 + 0.75 * folds) : mix(exp(-pow(dd / 0.09, 2.0)), 0.55, smoothstep(0.0, 0.3, dd));
  return vec2(curtain * smoothstep(0.97, 0.7, length(uv)) * (1.05 + 0.35 * energy) * (1.0 + 0.4 * bloom), -dd);
}

void main() {
  float h = res.x * 0.5;
  vec2 p = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);
  vec2 uv = (p - h) / h;
  float r = length(uv);
  float alpha = smoothstep(1.0, 1.0 - 1.5 / h, r);
  if (alpha <= 0.0) { o = vec4(0.0); return; }
  float px = 1.0 / h; // one device pixel in uv, so thin lines stay a pixel wide on a small orb

  vec2 a = aurora(uv);
  vec3 hue = mix(mix(ICE, deep, clamp(uv.x * 0.5 + 0.5, 0.0, 1.0)), mid, clamp(a.y * 1.4, 0.0, 1.0));
  vec3 col = vec3(0.955, 0.965, 0.995);
  col = mix(col, hue, clamp(a.x, 0.0, 1.0) * 0.5);
  // Halftone: one dot per cell where the aurora at the cell's centre beats the cell's Bayer threshold.
  vec2 idx = floor(p / pitch), cell = (idx + 0.5) * pitch;
  float lit = aurora((cell - h) / h).x;
  // Round dots, kept crisp on small grids: one pixel on a 3 px grid, a 2x2 square on a 4 px grid.
  float rad = pitch < 3.5 ? 0.6 : pitch < 4.5 ? 0.95 : pitch * 0.37;
  float ink = step(bayer8(idx) * 0.8 + 0.08, lit) * (1.0 - smoothstep(rad - 0.3, rad + 0.3, length(p - cell)));
  col = mix(col, hue * 0.88, ink * 0.85);

  // Glass: brighter towards the rim, a faint cool fringe, a thin bright edge, a soft bloom behind the glyph.
  col = mix(col, vec3(1.0), pow(r, 3.0) * 0.3);
  float an = atan(uv.y, uv.x);
  vec3 irid = 0.6 + 0.4 * cos(an + t * 0.15 + vec3(0.0, 2.1, 4.2));
  col = mix(col, irid * vec3(0.72, 0.82, 1.0), smoothstep(0.86, 0.97, r) * (0.5 + 0.5 * sin(an * 2.0 + t * 0.3)) * 0.3);
  col += exp(-pow((r - 0.972) / max(0.022, px), 2.0)) * 0.3;
  col = mix(col, vec3(1.0), exp(-r * r * 8.0) * 0.5);
  col += bloom * (0.18 * hot + 0.12) * exp(-r * r * 1.5);

  // Fixed reflections: window highlight top-left, crescent bottom-right, soft base shade, a hairline of blue at the edge.
  vec2 w = (uv - vec2(-0.34, -0.5)) * vec2(1.0, 1.9);
  col += exp(-dot(w, w) * 9.0) * 0.55;
  vec2 n = r > 0.001 ? uv / r : vec2(0.0);
  col += exp(-pow((r - 0.88) / max(0.06, px), 2.0)) * smoothstep(0.3, 0.9, dot(n, normalize(vec2(0.6, 0.8)))) * 0.25;
  col *= 1.0 - 0.06 * smoothstep(0.1, 1.0, uv.y) * r;
  col = mix(col, deep, smoothstep(1.0 - 2.5 * px, 1.0, r) * 0.35);

  o = vec4(min(col, 1.0) * alpha, alpha);
}`;
const VERTEX = "#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";
const UNIFORMS = ["res", "t", "ang", "energy", "bloom", "pitch", "deep", "mid", "hot"] as const;
/** Where the aurora starts, so every still orb shows the same, pleasing frame. */
const T0 = 7;
const FRAME_MS = 1000 / 60 - 4; // a 120 Hz screen draws every other frame: 60 fps at most

// One WebGL 2 context for every orb on the page: each orb copies its frame into its own 2D canvas (live) or an image
// (still). Released when the last orb that holds it unmounts.
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

/** Draws one frame `px` device pixels square into the shared canvas; copy it out in the same task. */
function paint({ gl, canvas, at }: Renderer, px: number, scale: number, app: App, t: number, ang: number, look: Look) {
  if (canvas.width !== px) { canvas.width = canvas.height = px; gl.viewport(0, 0, px, px); }
  const palette = PALETTE[app];
  gl.uniform3fv(at.deep, palette.deep);
  gl.uniform3fv(at.mid, palette.mid);
  gl.uniform3fv(at.hot, palette.hot);
  gl.uniform2f(at.res, px, px);
  // Dots on a grid about 1/24 of the orb, in whole device pixels so the grid never beats; on a 1x screen 4 px (3 on a mark).
  gl.uniform1f(at.pitch, scale < 1.5 ? (px >= 40 ? 4 : 3) : Math.ceil(Math.max(2, px / scale / 24) * scale));
  gl.uniform1f(at.t, t);
  gl.uniform1f(at.ang, ang);
  gl.uniform1f(at.energy, look.energy);
  gl.uniform1f(at.bloom, look.bloom);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

const density = () => Math.min(devicePixelRatio || 1, 2);

/** The centre glyph, crisp on top of the glass: sparkle at rest, three rising dots while thinking, ✓ when answered. */
function Glyph({ state }: { state: OrbState }) {
  const glyph = state === "thinking" ? "dots" : state === "answered" ? "check" : "spark";
  return (
    <svg className="sona-orb-glyph" viewBox="0 0 24 24" data-glyph={glyph} aria-hidden="true">
      <path className="sona-orb-spark" d="M12 3l1.9 5.6a2 2 0 0 0 1.5 1.5L21 12l-5.6 1.9a2 2 0 0 0-1.5 1.5L12 21l-1.9-5.6a2 2 0 0 0-1.5-1.5L3 12l5.6-1.9a2 2 0 0 0 1.5-1.5z" />
      <g className="sona-orb-dots"><circle cx="7" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="17" cy="12" r="1.7" /></g>
      <path className="sona-orb-check" d="M6.5 12.5l3.6 3.6L17.5 8.5" />
    </svg>
  );
}

/**
 * The Sona orb, drawn live: no frame at rest (one still frame on mount), the aurora curls while hovered, circles while
 * thinking and blooms once when answered, then eases back and stops drawing. Paused while the tab is hidden or the orb
 * is off screen; a still frame under Reduce Motion. Without WebGL 2, a CSS glass sphere. Decorative.
 */
export function SonaOrb({ app, state, size = 56 }: { app: App; state: OrbState; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = useRef(LOOK[state]);
  const wake = useRef<() => void>(null);
  const [gl, setGl] = useState(true);

  // Before the first paint, so the sphere never flashes empty.
  useLayoutEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d");
    const renderer = acquire();
    if (!renderer || !ctx) { setGl(false); return; }
    const scale = density(), px = Math.round(size * scale);
    el.width = el.height = px;
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    let look = still.matches ? target.current : LOOK.rest, t = T0, ang = 0, last = 0, drawn = 0, frame = 0, onScreen = true;

    const render = () => {
      paint(renderer, px, scale, app, t, ang, look);
      ctx.clearRect(0, 0, px, px);
      ctx.drawImage(renderer.canvas, 0, 0);
    };
    const draw = (time: number) => {
      frame = 0;
      if (document.hidden || !onScreen) { last = 0; return; }
      if (drawn && time - drawn < FRAME_MS) { frame = requestAnimationFrame(draw); return; }
      drawn = time;
      const dt = last ? Math.min((time - last) / 1000, 0.1) : 0;
      last = time;
      if (still.matches) look = target.current;
      else {
        look = step(look, target.current, dt);
        t += dt * look.speed;
        ang += dt * look.spin;
      }
      render();
      if (!still.matches && moving(look, target.current)) frame = requestAnimationFrame(draw);
      else last = 0;
    };
    const start = () => { if (!frame) frame = requestAnimationFrame(draw); };
    wake.current = start;
    render();
    if (look !== target.current) start();

    const seen = new IntersectionObserver(([entry]) => { onScreen = entry!.isIntersecting; start(); });
    seen.observe(el);
    document.addEventListener("visibilitychange", start);
    still.addEventListener("change", start);
    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      document.removeEventListener("visibilitychange", start);
      still.removeEventListener("change", start);
      wake.current = null;
      release();
    };
  }, [app, size]);

  useEffect(() => {
    target.current = LOOK[state];
    wake.current?.();
  }, [state]);

  return (
    <span className="sona-orb-visual" data-state={state} data-gl={gl ? undefined : "off"} style={{ width: size, height: size }} aria-hidden="true">
      <canvas ref={canvas} />
      <Glyph state={state} />
    </span>
  );
}

// Still orbs are drawn once per size and app, then shown as an image: a thread of answers costs no context.
const stills = new Map<string, string>();
function stillImage(size: number, app: App) {
  const scale = density(), key = `${size}:${app}:${scale}`;
  const cached = stills.get(key);
  if (cached !== undefined) return cached;
  const renderer = acquire();
  if (!renderer) return "";
  paint(renderer, Math.round(size * scale), scale, app, T0, 0, LOOK.rest);
  const url = renderer.canvas.toDataURL();
  release();
  stills.set(key, url);
  return url;
}

/** Sona's mark: the same orb, small and still (28 px), with the sparkle. Decorative. */
export function SonaOrbMark({ app = "pro", size = 28 }: { app?: App; size?: number }) {
  const [src] = useState(() => stillImage(size, app));
  return (
    <span className="sona-orb-visual sona-orb-mark" data-gl={src ? undefined : "off"} aria-hidden="true"
      style={{ width: size, height: size, backgroundImage: src ? `url(${src})` : undefined }}>
      <Glyph state="rest" />
    </span>
  );
}

/** True for BLOOM_MS after `unseen` turns on: an answer just arrived while the panel was closed. */
function useBloom(unseen: boolean) {
  const [blooming, setBlooming] = useState(false);
  const was = useRef(unseen);
  useEffect(() => {
    const rose = unseen && !was.current;
    was.current = unseen;
    if (!rose) return;
    setBlooming(true);
    const id = setTimeout(() => setBlooming(false), BLOOM_MS);
    return () => clearTimeout(id);
  }, [unseen]);
  return blooming;
}

/**
 * The closed Sona panel's button: the orb in the corner. It thinks while an answer is pending, blooms with ✓ when one
 * arrives, then rests with a dot until the panel opens; hover or focus wakes it.
 */
export function SonaOrbButton({ app, pending, unseen, ...button }: { app: App; pending: boolean; unseen: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const [hover, setHover] = useState(false);
  const blooming = useBloom(unseen);
  const state = orbState({ closed: true, pending, blooming, hover });
  return (
    <button type="button" className="sona-orb" data-state={state} {...button}
      onPointerEnter={e => { if (e.pointerType !== "touch") setHover(true); }} onPointerLeave={() => setHover(false)}
      onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <SonaOrb app={app} state={state} />
      {unseen && !blooming ? <span className="sona-orb-badge" aria-hidden="true" /> : null}
    </button>
  );
}
