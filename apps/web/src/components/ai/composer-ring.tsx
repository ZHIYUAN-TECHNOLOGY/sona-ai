import { type RefObject, useEffect, useRef } from "react";

import { ringTarget } from "./composer-motion";

// The composer's living edge, after libraries.dev/metal in Sona's colours: a thin liquid-metal line on the box's
// rounded edge with a soft halo that wanders around it. `u` runs once around the edge (arc length, so the long sides
// and the round ends move at one pace); the bands use whole multiples of it so the ring has no seam. Each colour
// channel reads the ramp a little apart, a faint chromatic sheen on the bright bands. The pointer swells the edge
// toward it; `glow` brightens it, `flow` carries it around, `level` (the voice) thickens it.
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 res, half_, pointer;
uniform float radius, scale, t, flow, glow, level, pull;
uniform vec3 deep, mid, cyan, ice;
out vec4 o;

const float PI = 3.14159265;

vec3 ramp(float x) {
  x = clamp(x, 0.0, 1.0);
  if (x < 0.4) return mix(deep, mid, x / 0.4);
  if (x < 0.65) return mix(mid, cyan, (x - 0.4) / 0.25);
  if (x < 0.85) return mix(cyan, ice, (x - 0.65) / 0.2);
  return mix(ice, vec3(1.0), (x - 0.85) / 0.15);
}

void main() {
  vec2 p = gl_FragCoord.xy - res * 0.5;
  vec2 c = max(half_ - radius, 0.0);
  vec2 q = clamp(p, -c, c);
  vec2 v = p - q;
  float d = length(max(abs(p) - c, 0.0)) + min(max(abs(p).x - c.x, abs(p).y - c.y), 0.0) - radius;

  // Arc length around the edge, counter-clockwise from the middle of the right end.
  float th = atan(v.y, v.x);
  if (th < 0.0) th += 2.0 * PI;
  float s = th < 0.5 * PI ? q.y + c.x - q.x
          : th < PI ? c.y + c.x - q.x + c.y - q.y
          : th < 1.5 * PI ? 2.0 * c.y + 3.0 * c.x - q.y + q.x
          : 3.0 * c.y + 3.0 * c.x + q.x + q.y + c.y;
  float A = 2.0 * PI * (s + radius * th) / (4.0 * (c.x + c.y) + 2.0 * PI * radius);

  // The pointer: the edge swells toward it and catches the light there.
  vec2 dp = (p - pointer) / (56.0 * scale);
  float near = pull * exp(-dot(dp, dp));
  d -= near * 3.0 * scale;

  float wob = 0.9 * sin(t * 0.5 + A);
  float b = 0.5 + 0.5 * (0.55 * sin(A + flow + wob) + 0.3 * sin(2.0 * A - t * 0.37 + 1.7) + 0.15 * sin(3.0 * A + t * 0.61 - flow * 0.5));
  b = smoothstep(0.12, 0.95, clamp(b + near * 0.5, 0.0, 1.0));
  float k = 0.045;
  vec3 col = vec3(ramp(b - k).r, ramp(b).g, ramp(b + k).b);
  float spec = pow(b, 12.0); // the metal's hot glint
  col = mix(col, vec3(1.0), spec * 0.8);

  float spot = pow(b, 3.0) * 1.3 + 0.08;
  float w = (0.55 + 0.45 * glow + 0.6 * level) * scale;
  float line = 1.0 - smoothstep(w * 0.5, w + 0.8 * scale, abs(d + 0.35 * scale));
  float halo = d > 0.0 ? exp(-d / ((2.0 + 4.0 * glow + 4.0 * level) * scale)) * (0.06 + 0.5 * glow + 0.4 * level) * spot : 0.0;
  float inner = d < 0.0 ? exp(d / (2.5 * scale)) * 0.2 * glow * spot : 0.0;
  float a = line * ((0.45 + 0.55 * glow) * (0.55 + 0.45 * b) + spec * 0.5) + halo + inner + near * 0.25 * exp(-abs(d) / (6.0 * scale));
  a = clamp(a, 0.0, 1.0) * (1.0 - smoothstep(7.0 * scale, 13.0 * scale, d)); // gone before the canvas edge
  o = vec4(col * a, a);
}`;
const VERTEX = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

// Deep blue to the app's blue, a cyan shoulder, ice and white on the brightest band.
const PALETTE = {
  pro: { deep: [0.106, 0.278, 0.651], mid: [0.141, 0.357, 0.8], cyan: [0.42, 0.78, 0.96], ice: [0.82, 0.89, 1] },
  care: { deep: [0.114, 0.306, 0.847], mid: [0.145, 0.388, 0.922], cyan: [0.4, 0.8, 0.97], ice: [0.86, 0.92, 1] },
};
const PAD = 14; // css px of halo around the box
const NEAR = 72; // css px: the pointer this close wakes the edge
const EASE = 7; // per second

function compile(gl: WebGL2RenderingContext) {
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
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const p = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(p);
  gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
  return program;
}

/**
 * The composer's edge (place it as the first child of the box). It rests on one still frame and only animates while
 * the box is focused, the pointer is near, Sona is working or the mic is listening, and not in a hidden tab or with
 * Reduce Motion. One WebGL2 context, released on unmount; without WebGL2 a still CSS ring stands in.
 */
export function ComposerRing({ app, focused, working, recording, level }: { app: "pro" | "care"; focused: boolean; working: boolean; recording: boolean; level: RefObject<number> }) {
  const host = useRef<HTMLSpanElement>(null);
  const state = useRef({ focused, working, recording });
  const wake = useRef<() => void>(null);

  useEffect(() => {
    state.current = { focused, working, recording };
    wake.current?.();
  }, [focused, working, recording]);

  useEffect(() => {
    const span = host.current!;
    const box = span.parentElement!;
    // A fresh canvas per mount: a released context can't be had again from the same canvas.
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
    const program = gl ? compile(gl) : null;
    if (!gl || !program) {
      span.dataset.fallback = "";
      return () => { delete span.dataset.fallback; };
    }
    span.append(canvas);
    const u = Object.fromEntries(["res", "half_", "pointer", "radius", "scale", "t", "flow", "glow", "level", "pull", "deep", "mid", "cyan", "ice"].map(n => [n, gl.getUniformLocation(program, n)]));
    for (const [name, rgb] of Object.entries(PALETTE[app])) gl.uniform3fv(u[name]!, rgb);

    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const fine = matchMedia("(hover: hover) and (pointer: fine)");
    const now = { glow: 0.2, speed: 0, level: 0, pull: 0 };
    const pointer = { x: 0, y: 0, pull: 0 };
    let near = false, scale = 1, t = 0, flow = 0, last = 0, frame = 0;
    const target = () => ringTarget({ ...state.current, near, reduced: still.matches });

    const paint = () => {
      gl.uniform1f(u.t!, t);
      gl.uniform1f(u.flow!, flow);
      gl.uniform1f(u.glow!, now.glow);
      gl.uniform1f(u.level!, now.level);
      gl.uniform1f(u.pull!, now.pull);
      gl.uniform2f(u.pointer!, pointer.x, pointer.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const tick = (time: number) => {
      frame = 0;
      const goal = target();
      const dt = last ? Math.min((time - last) / 1000, 0.1) : 0;
      last = time;
      const k = still.matches ? 1 : 1 - Math.exp(-EASE * dt);
      const aims = { glow: goal.glow, speed: goal.speed, level: goal.pulse * (0.25 + 0.75 * (level.current ?? 0)), pull: near ? pointer.pull : 0 };
      let settled = true;
      for (const key of ["glow", "speed", "level", "pull"] as const) {
        now[key] += (aims[key] - now[key]) * k;
        if (Math.abs(aims[key] - now[key]) > 0.003) settled = false;
      }
      if (goal.animate) { t += dt; flow += dt * now.speed; }
      paint();
      if (goal.animate || !settled) frame = requestAnimationFrame(tick);
      else last = 0;
    };
    const start = () => { if (!frame && !document.hidden) frame = requestAnimationFrame(tick); };
    wake.current = start;
    const visibility = () => {
      if (!document.hidden) return start();
      cancelAnimationFrame(frame);
      frame = last = 0;
    };

    const fit = new ResizeObserver(() => {
      scale = Math.min(devicePixelRatio, 2);
      const w = box.offsetWidth, h = box.offsetHeight;
      canvas.width = Math.round((w + PAD * 2) * scale);
      canvas.height = Math.round((h + PAD * 2) * scale);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.res!, canvas.width, canvas.height);
      gl.uniform2f(u.half_!, (w / 2) * scale, (h / 2) * scale);
      gl.uniform1f(u.radius!, Math.min(parseFloat(getComputedStyle(box).borderTopLeftRadius) || 0, w / 2, h / 2) * scale);
      gl.uniform1f(u.scale!, scale);
      paint(); // resizing clears the canvas: redraw before it shows
    });
    fit.observe(box);

    const move = (event: PointerEvent) => {
      const r = box.getBoundingClientRect();
      const gap = Math.hypot(Math.max(r.left - event.clientX, 0, event.clientX - r.right), Math.max(r.top - event.clientY, 0, event.clientY - r.bottom));
      const was = near;
      near = gap < NEAR;
      if (near) Object.assign(pointer, { x: (event.clientX - r.left - r.width / 2) * scale, y: (r.top + r.height / 2 - event.clientY) * scale, pull: 1 - gap / NEAR });
      if (near || was) start();
    };
    const leave = () => { if (near) { near = false; start(); } };
    if (fine.matches) {
      addEventListener("pointermove", move, { passive: true });
      document.documentElement.addEventListener("pointerleave", leave);
    }
    document.addEventListener("visibilitychange", visibility);

    return () => {
      cancelAnimationFrame(frame);
      fit.disconnect();
      removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", visibility);
      wake.current = null;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, [app, level]);

  return <span ref={host} className="ai-composer-ring" aria-hidden="true" />;
}
