import { type RefObject, useEffect, useRef } from "react";

// The phone apps' voice glow (apps/care/lib/voice-glow.tsx), the same shader in GLSL, drawn inside the bar: dots on a
// 2px grid, ordered (Bayer 8x8) dithering, rising from the bar's bottom edge. Four soft lobes wave along it and bloom
// with `level`, the voice. `on` fades it in and out.
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 res;
uniform float t, level, on, pitch;
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
  float x = cell.x / res.x;
  float y = cell.y / res.y;
  float h = (lobes(x) * (0.2 + 0.8 * level) + 0.08) * on;
  float I = clamp(1.0 - y / max(h, 0.001), 0.0, 1.0);
  I = pow(I, 1.3);
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
const PITCH = 2;
const EASE = 6; // per second: the glow follows the voice within a fifth of a second

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
 * The dithered glow inside the Sona bar: the bar's answer to a voice. Nothing is drawn until the mic hears; then dots
 * rise from the bottom edge, wave, and bloom with the voice (`level`, 0 to 1, a ref because it moves many times a
 * second), and fade when the mic lets go. No frame is drawn at any other time. Decoration only: without WebGL
 * nothing is drawn.
 */
export function SonaGlow({ app, listening, level }: { app: "pro" | "care"; listening: boolean; level: RefObject<number> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // The loop reads this; the effect below wakes it when the mic starts or stops.
  const hearing = useRef(listening);
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
    const at = { res: uniform("res"), t: uniform("t"), level: uniform("level"), on: uniform("on"), pitch: uniform("pitch") };

    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const now = { on: 0, level: 0 };
    let t = 0, last = 0, frame = 0;

    const draw = (time: number) => {
      frame = 0;
      const dt = last ? Math.min((time - last) / 1000, 0.1) : 0;
      last = time;
      const on = hearing.current ? 1 : 0;
      const heard = on * (0.45 + 0.55 * level.current);
      const k = 1 - Math.exp(-EASE * dt);
      now.on += (on - now.on) * k;
      now.level += (heard - now.level) * k;
      // Reduce Motion: no waving or sweep, the glow only brightens and dims.
      if (!still.matches) t += dt;
      gl.uniform1f(at.t, t);
      gl.uniform1f(at.level, now.level);
      gl.uniform1f(at.on, now.on);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Keep drawing while the mic hears, then until the glow has faded out.
      if (on || now.on > 0.005) frame = requestAnimationFrame(draw);
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
    hearing.current = listening;
    wake.current?.();
  }, [listening]);

  return <canvas ref={canvas} className="sona-glow" aria-hidden="true" />;
}
