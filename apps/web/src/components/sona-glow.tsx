import { type CSSProperties, type RefObject, useEffect, useRef } from "react";

import { useSonaThinking } from "@/lib/sona";

/** What the bar is doing: at rest, in use (focused or holding a draft), hearing the mic, or working on it. */
export type GlowMode = "rest" | "awake" | "listening" | "thinking";

// The phone apps' voice glow (apps/care/lib/voice-glow.tsx), the same dithering in GLSL: dots on a 3px grid, ordered
// (Bayer 8x8). Here it is a halo around the bar's pill instead of a rise from the screen's edge: four soft lobes wave
// along the bar and bloom with `level`; while Sona thinks they gather into one beam that sweeps side to side. `on`
// fades it in and out. `pad` is the room around the pill inside the canvas: sides, below, above.
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 res;
uniform vec3 pad;
uniform float t, level, think, on, pitch;
uniform vec3 deep, mid, hot;

float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

float lobes(float x) {
  float h = 0.0;
  for (int i = 0; i < 4; i++) {
    float f = float(i);
    float c = 0.2 + 0.2 * f + 0.05 * sin(t * (0.5 + 0.13 * f) + f * 1.7);
    float w = 0.14 + 0.03 * sin(t * 0.7 + f);
    float a = 0.7 + 0.3 * sin(t * (1.1 + 0.2 * f) + f * 2.3);
    float d = (x - c) / w;
    h += a * exp(-d * d);
  }
  return h * 0.8;
}

void main() {
  vec2 q = gl_FragCoord.xy;
  vec2 idx = floor(q / pitch);
  vec2 cell = (idx + 0.5) * pitch;
  // Distance from the pill's edge; under the bar there is less room, so the halo is squeezed there.
  vec2 lo = pad.xy, hi = res - pad.xz;
  vec2 mid2 = 0.5 * (lo + hi), size = 0.5 * (hi - lo);
  vec2 away = abs(cell - mid2) - vec2(size.x - size.y, 0.0);
  float d = length(max(away, 0.0)) - size.y;
  // Nothing behind the bar itself but a rim, which its glass blurs into a faint tint: the text stays on white.
  if (d < -2.0 * pitch) { gl_FragColor = vec4(0.0); return; }
  d = max(d, 0.0);
  d *= mix(1.0, pad.z / pad.y, clamp((mid2.y - cell.y) / size.y, 0.0, 1.0));
  float x = cell.x / res.x;
  float b = (x - (0.5 + 0.3 * sin(t * 1.5))) / 0.11;
  float shape = min(mix(lobes(x) * (0.2 + 0.8 * level), exp(-b * b), think), 1.0);
  float reach = pad.z * (0.25 + 0.75 * shape) * on;
  float I = clamp(1.0 - d / max(reach, 0.001), 0.0, 1.0);
  I *= I * 0.85;
  if (I <= bayer8(idx)) { gl_FragColor = vec4(0.0); return; }
  vec3 col = I < 0.5 ? mix(hot, mid, I * 2.0) : mix(mid, deep, I * 2.0 - 1.0);
  float a = (1.0 - smoothstep(pitch * 0.32, pitch * 0.42, length(q - cell))) * (0.55 + 0.45 * I) * on;
  gl_FragColor = vec4(col * a, a);
}`;
const VERTEX = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";

// Lilac at the faint edge, the app's blue in the core: Sona Pro's blue, Sona Care's azure.
const PALETTE = {
  pro: { deep: [0.141, 0.357, 0.8], mid: [0.42, 0.46, 0.92], hot: [0.62, 0.76, 0.95] },
  care: { deep: [0.145, 0.388, 0.922], mid: [0.62, 0.52, 0.945], hot: [0.78, 0.68, 0.975] },
};
// Where each mode settles: how lit, how far the halo reaches, and whether the lobes gather into the beam.
const TARGET: Record<GlowMode, { on: number; level: number; think: number }> = {
  rest: { on: 0.7, level: 0.5, think: 0 },
  awake: { on: 1, level: 0.9, think: 0 },
  listening: { on: 1, level: 0.9, think: 0 },
  thinking: { on: 1, level: 0.9, think: 1 },
};
const PITCH = 3;
// Room for the halo around the bar, in CSS px. Below is the gap between the bar and the window's edge.
const PAD = { side: 56, below: 16, above: 56 };
const PLACE: CSSProperties = { left: -PAD.side, top: -PAD.above, width: `calc(100% + ${2 * PAD.side}px)`, height: `calc(100% + ${PAD.above + PAD.below}px)` };
const EASE = 4; // per second: a mode change settles in about a second

function compile(gl: WebGLRenderingContext) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  // One triangle that covers the canvas.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const p = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(p);
  gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
  return program;
}

/**
 * The dithered glow around the Sona bar. It rests as a still, faint halo of dots; wakes and waves while the bar is in
 * use; blooms with the voice (`level`, 0 to 1, a ref because it moves many times a second); and gathers into a
 * sweeping beam while Sona works on an answer. Frames are drawn only while something moves: at rest it holds one.
 * Decoration only: without WebGL nothing is drawn.
 */
export function SonaGlow({ app, mode, level }: { app: "pro" | "care"; mode: GlowMode; level: RefObject<number> }) {
  const thinking = useSonaThinking();
  const shown: GlowMode = thinking && mode !== "listening" ? "thinking" : mode;
  const canvas = useRef<HTMLCanvasElement>(null);
  // The loop reads the mode from here; the effect below wakes it when the mode changes.
  const wanted = useRef(shown);
  const wake = useRef<() => void>(null);

  useEffect(() => {
    const el = canvas.current;
    const gl = el?.getContext("webgl", { premultipliedAlpha: true, antialias: false });
    const program = gl ? compile(gl) : null;
    if (!el || !gl || !program) return;
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const palette = PALETTE[app];
    gl.uniform3fv(uniform("deep"), palette.deep);
    gl.uniform3fv(uniform("mid"), palette.mid);
    gl.uniform3fv(uniform("hot"), palette.hot);
    const at = { res: uniform("res"), pad: uniform("pad"), t: uniform("t"), level: uniform("level"), think: uniform("think"), on: uniform("on"), pitch: uniform("pitch") };

    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const now = { ...TARGET.rest, on: 0 };
    let t = 0, last = 0, frame = 0;

    const draw = (time: number) => {
      frame = 0;
      const dt = last ? Math.min((time - last) / 1000, 0.1) : 0;
      last = time;
      const mode = wanted.current;
      const target = TARGET[mode];
      const heard = mode === "listening" ? 0.5 + 0.5 * level.current : target.level;
      const k = 1 - Math.exp(-EASE * dt);
      now.on += (target.on - now.on) * k;
      now.level += (heard - now.level) * k;
      now.think += (target.think - now.think) * k;
      // Reduce Motion: no waving or sweep, the glow only brightens and dims.
      if (!still.matches) t += dt;
      gl.uniform1f(at.t, t);
      gl.uniform1f(at.level, now.level);
      gl.uniform1f(at.think, now.think);
      gl.uniform1f(at.on, now.on);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const settled = Math.abs(target.on - now.on) + Math.abs(heard - now.level) + Math.abs(target.think - now.think) < 0.005;
      const moving = mode === "listening" || (mode !== "rest" && !still.matches);
      if (moving || !settled) frame = requestAnimationFrame(draw);
      else last = 0;
    };
    const start = () => { if (!frame) frame = requestAnimationFrame(draw); };
    wake.current = start;

    // The canvas keeps the element's size at the screen's density (at most 2x); a resize redraws.
    const fit = new ResizeObserver(() => {
      const scale = Math.min(devicePixelRatio, 2);
      el.width = Math.round(el.clientWidth * scale);
      el.height = Math.round(el.clientHeight * scale);
      gl.viewport(0, 0, el.width, el.height);
      gl.uniform2f(at.res, el.width, el.height);
      gl.uniform3f(at.pad, PAD.side * scale, PAD.below * scale, PAD.above * scale);
      gl.uniform1f(at.pitch, PITCH * scale);
      start();
    });
    fit.observe(el);
    return () => {
      fit.disconnect();
      cancelAnimationFrame(frame);
      wake.current = null;
    };
  }, [app, level]);

  useEffect(() => {
    wanted.current = shown;
    wake.current?.();
  }, [shown]);

  return <canvas ref={canvas} className="sona-glow" style={PLACE} aria-hidden="true" />;
}
