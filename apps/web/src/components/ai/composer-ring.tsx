import { type RefObject, useEffect, useRef } from "react";

import { BEAT_GAP, beatPeriod, beatStrength, RIPPLE_S, ringTarget, ripple } from "./composer-motion";

// The composer's edge as liquid glass (docs/design-direction.md, "glass first"; the rim of components/sona-orb.tsx): a
// pane's lip, not a coloured line. A pale cool hairline, a 1px white highlight along the top inside, and a soft ice band
// along the bottom inside where light bends through the glass. `a` is arc length round the edge (px, so the long sides
// and the round ends move at one pace). Light moves along it: a ripple when the box is focused, a gentle wave while Sona
// works (both swell the rim a touch, like water), and while listening a lub-dub heartbeat that travels out from the
// mic both ways, its crest faintly Sona blue. The pointer brightens the nearest stretch.
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 res, half_, pointer, origin;
uniform float radius, scale, glow, pull, wave, waveAt, flow, flowAt, beat, period, beatAmp;
uniform vec3 tint, ice;
out vec4 o;

const float PI = 3.14159265;
vec2 c;
float P;

// Arc length to the edge point nearest p, counter-clockwise from the middle of the right end.
float arc(vec2 p) {
  vec2 q = clamp(p, -c, c), v = p - q;
  float th = atan(v.y, v.x);
  if (th < 0.0) th += 2.0 * PI;
  float s = th < 0.5 * PI ? q.y + c.x - q.x
          : th < PI ? c.y + c.x - q.x + c.y - q.y
          : th < 1.5 * PI ? 2.0 * c.y + 3.0 * c.x - q.y + q.x
          : 3.0 * c.y + 3.0 * c.x + q.x + q.y + c.y;
  return s + radius * th;
}
float apart(float a, float b) { float x = mod(a - b, P); return min(x, P - x); }
float bump(float x, float w) { return exp(-x * x / (w * w)); }
// composer-motion.ts heartbeat(), unscaled.
float swell(float u) { return u < 0.0 ? 0.0 : (u / 0.05) * exp(1.0 - u / 0.05); }
float lubdub(float x) { return min(1.0, swell(x) + 0.7 * swell(x - ${BEAT_GAP.toFixed(2)})); }
void over(inout vec4 o, vec3 col, float a) { a = clamp(a, 0.0, 1.0); o = vec4(col * a, a) + o * (1.0 - a); }

void main() {
  float u = scale; // one css px
  vec2 p = gl_FragCoord.xy - res * 0.5;
  c = max(half_ - radius, 0.0);
  P = 4.0 * (c.x + c.y) + 2.0 * PI * radius;
  vec2 v = p - clamp(p, -c, c);
  vec2 n = length(v) > 0.0 ? v / length(v) : vec2(0.0, sign(p.y));
  float d = length(max(abs(p) - c, 0.0)) + min(max(abs(p).x - c.x, abs(p).y - c.y), 0.0) - radius;
  float a = arc(p);

  float band = wave * bump(apart(a, waveAt * P), 80.0 * u)
             + flow * 0.75 * (bump(apart(a, flowAt * P), 120.0 * u) + bump(apart(a, (flowAt + 0.5) * P), 120.0 * u));
  float far = apart(a, arc(origin));
  float hb = beatAmp * lubdub(mod(beat - far / (1100.0 * u), period)) * (0.3 + 0.7 * exp(-far / (500.0 * u)));
  vec2 dp = (p - pointer) / (64.0 * u);
  float near = pull * exp(-dot(dp, dp));
  float lift = band + 1.5 * hb;
  d -= lift * 0.9 * u; // the light swells the rim a touch, like water

  float up = smoothstep(-0.2, 0.9, n.y), down = 1.0 - smoothstep(-0.9, 0.2, n.y);
  float lip = 1.0 - smoothstep(0.2 * u, 1.1 * u, abs(d + 0.5 * u));
  float hi = 1.0 - smoothstep(0.1 * u, 0.9 * u, abs(d + 1.4 * u));
  float inner = d < 0.0 ? exp(d / (3.0 * u)) : 0.0;
  float halo = d > 0.0 ? exp(-d / ((2.0 + 3.0 * lift) * u)) : 0.0;
  float crest = smoothstep(0.3, 0.9, hb);
  float shine = clamp(lift, 0.0, 1.0);
  vec3 light = mix(ice, tint, 0.25 + 0.45 * crest);

  vec4 col = vec4(0.0);
  over(col, light, halo * (0.05 * glow + 0.45 * lift + 0.12 * near));
  over(col, ice, inner * down * (0.35 + 0.15 * glow + 0.3 * lift));
  over(col, mix(mix(tint, vec3(1.0), 0.55), tint, 0.5 * shine), lip * (0.2 + 0.12 * glow + 0.6 * lift + 0.25 * near));
  over(col, vec3(1.0), hi * max(up, 0.5 * down) * (0.85 + 0.15 * glow));
  over(col, light, inner * (0.25 * lift + 0.1 * near));
  o = col * (1.0 - smoothstep(7.0 * u, 13.0 * u, d)); // gone before the canvas edge
}`;
const VERTEX = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

// The app's blue for the beat's crest; ice for the refracted band and the light.
const PALETTE = {
  pro: { tint: [0.141, 0.357, 0.8], ice: [0.82, 0.9, 1] },
  care: { tint: [0.145, 0.388, 0.922], ice: [0.84, 0.91, 1] },
};
const PAD = 14; // css px of halo around the box
const NEAR = 72; // css px: the pointer this close brightens the rim
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
 * The composer's glass rim (place it as the first child of the box). It rests on one still frame and only animates for
 * the focus ripple, while Sona works or the mic listens, and briefly as the pointer comes near; never in a hidden tab or
 * with Reduce Motion. One WebGL2 context, released on unmount; without WebGL2 a still CSS rim stands in.
 */
export function ComposerRing({ app, focused, working, recording, level }: { app: "pro" | "care"; focused: boolean; working: boolean; recording: boolean; level: RefObject<number> }) {
  const host = useRef<HTMLSpanElement>(null);
  const state = useRef({ focused, working, recording });
  const wake = useRef<(focus: boolean) => void>(null);

  useEffect(() => {
    const focus = focused && !state.current.focused;
    state.current = { focused, working, recording };
    wake.current?.(focus);
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
    const u = Object.fromEntries(["res", "half_", "pointer", "origin", "radius", "scale", "glow", "pull", "wave", "waveAt", "flow", "flowAt", "beat", "period", "beatAmp", "tint", "ice"].map(n => [n, gl.getUniformLocation(program, n)]));
    for (const [name, rgb] of Object.entries(PALETTE[app])) gl.uniform3fv(u[name]!, rgb);

    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const fine = matchMedia("(hover: hover) and (pointer: fine)");
    const now = { glow: 0, flow: 0, beat: 0, level: 0, pull: 0 };
    const pointer = { x: 0, y: 0, pull: 0 };
    let near = false, scale = 1, last = 0, frame = 0, flowAt = 0, cycle = 0, rip = RIPPLE_S;
    const target = () => ringTarget({ ...state.current, near, reduced: still.matches });

    // The heartbeat starts at the edge just under the mic.
    const aim = () => {
      const mic = box.querySelector(".ai-composer-mic")?.getBoundingClientRect(), r = box.getBoundingClientRect();
      gl.uniform2f(u.origin!, mic ? (mic.left + mic.width / 2 - r.left - r.width / 2) * scale : 0, -(r.height / 2 + 1) * scale);
    };
    const paint = (wave = ripple(rip)) => {
      const period = beatPeriod(now.level);
      gl.uniform1f(u.glow!, now.glow);
      gl.uniform1f(u.pull!, now.pull);
      gl.uniform1f(u.wave!, wave?.amp ?? 0);
      gl.uniform1f(u.waveAt!, wave?.at ?? 0);
      gl.uniform1f(u.flow!, now.flow);
      gl.uniform1f(u.flowAt!, flowAt);
      gl.uniform1f(u.beat!, cycle * period);
      gl.uniform1f(u.period!, period);
      gl.uniform1f(u.beatAmp!, now.beat * beatStrength(now.level));
      gl.uniform2f(u.pointer!, pointer.x, pointer.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const tick = (time: number) => {
      frame = 0;
      const goal = target();
      const dt = last ? Math.min((time - last) / 1000, 0.1) : 0;
      last = time;
      const k = still.matches ? 1 : 1 - Math.exp(-EASE * dt);
      const aims = { glow: goal.glow, flow: goal.animate ? goal.flow : 0, beat: goal.animate ? goal.beat : 0, level: goal.beat ? (level.current ?? 0) : 0, pull: near ? pointer.pull : 0 };
      let settled = true;
      for (const key of ["glow", "flow", "beat", "level", "pull"] as const) {
        now[key] += (aims[key] - now[key]) * k;
        if (Math.abs(aims[key] - now[key]) > 0.003) settled = false;
      }
      flowAt = (flowAt + dt * 0.3 * now.flow) % 1;
      cycle = (cycle + dt / beatPeriod(now.level)) % 1;
      const wave = still.matches ? null : ripple(rip);
      if (wave) rip += dt;
      paint(wave);
      if (goal.animate || wave || !settled) frame = requestAnimationFrame(tick);
      else last = 0;
    };
    const start = () => { if (!frame && !document.hidden) frame = requestAnimationFrame(tick); };
    wake.current = focus => {
      if (focus && !still.matches) rip = 0;
      if (state.current.recording) { aim(); cycle = 0; }
      start();
    };
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
      aim();
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
    start(); // mounted mid-work or mid-listening: move now (at rest this is one frame, then still)

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
