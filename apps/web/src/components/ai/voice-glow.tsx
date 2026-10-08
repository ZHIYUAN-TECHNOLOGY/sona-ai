import { type RefObject, useEffect, useRef, useState } from "react";

import { BAYER, BAYER_WGSL, compile, PALETTE } from "@/lib/sona-gl";
import { follow, pickRenderer, type Renderer } from "@/lib/voice";

type App = "pro" | "care";

// Sona Care's voice glow (apps/care/lib/voice-glow.tsx), rising from the composer's bottom edge while the mic listens:
// dots on a 2 px grid, ordered (Bayer 8x8) dithering, four soft lobes that wave along the edge and bloom with `level`,
// the voice. `on` (0 to 1) fades it in and out. The same shader twice: WGSL for WebGPU, GLSL for WebGL 2.
const GLSL = `#version 300 es
precision highp float;
uniform vec2 res;
uniform float t, level, on, pitch;
uniform vec3 deep, mid, hot;
out vec4 o;
${BAYER}
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
  vec2 idx = floor(q / pitch), cell = (idx + 0.5) * pitch;
  float h = (lobes(cell.x / res.x) * (0.2 + 0.8 * level) + 0.08) * on;
  float I = pow(clamp(1.0 - cell.y / max(h * res.y, 0.001), 0.0, 1.0), 1.3);
  if (I <= bayer8(idx)) { o = vec4(0.0); return; }
  vec3 col = I < 0.5 ? mix(hot, mid, I * 2.0) : mix(mid, deep, I * 2.0 - 1.0);
  float a = (1.0 - smoothstep(pitch * 0.32, pitch * 0.42, length(q - cell))) * (0.55 + 0.45 * I) * on;
  o = vec4(col * a, a);
}`;
const VERTEX = "#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";

const WGSL = /* wgsl */ `
struct U { res: vec2f, t: f32, level: f32, on: f32, pitch: f32, deep: vec4f, mid: vec4f, hot: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
${BAYER_WGSL}
fn lobes(x: f32) -> f32 {
  var h = 0.0;
  for (var i = 0; i < 4; i++) {
    let f = f32(i);
    let c = 0.2 + 0.2 * f + 0.05 * sin(u.t * (0.5 + 0.13 * f) + f * 1.7);
    let w = 0.14 + 0.03 * sin(u.t * 0.7 + f);
    let a = 0.7 + 0.3 * sin(u.t * (1.1 + 0.2 * f) + f * 2.3);
    let d = (x - c) / w;
    h += a * exp(-d * d);
  }
  return h * 0.8;
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let q = vec2f(pos.x, u.res.y - pos.y); // y up from the bottom edge, as in GL
  let idx = floor(q / u.pitch);
  let cell = (idx + 0.5) * u.pitch;
  let h = (lobes(cell.x / u.res.x) * (0.2 + 0.8 * u.level) + 0.08) * u.on;
  let I = pow(clamp(1.0 - cell.y / max(h * u.res.y, 0.001), 0.0, 1.0), 1.3);
  if (I <= bayer8(idx)) { return vec4f(0.0); }
  let col = select(mix(u.mid.rgb, u.deep.rgb, I * 2.0 - 1.0), mix(u.hot.rgb, u.mid.rgb, I * 2.0), I < 0.5);
  let a = (1.0 - smoothstep(u.pitch * 0.32, u.pitch * 0.42, length(q - cell))) * (0.55 + 0.45 * I) * u.on;
  return vec4f(col * a, a);
}`;

/** Draws one frame of the glow at time `t`; `size` follows the canvas; `release` lets go of what it holds. */
type Painter = { size(w: number, h: number, pitch: number): void; draw(t: number, level: number, on: number): void; release(): void };

// One WebGPU device (and pipeline) for every glow on the page, released when the last glow that holds it unmounts.
type Gpu = { device: GPUDevice; pipeline: GPURenderPipeline; format: GPUTextureFormat };
let gpu: Promise<Gpu | null> | null = null, gpuUsers = 0;
async function openGpu(): Promise<Gpu | null> {
  try {
    const adapter = await navigator.gpu.requestAdapter();
    const device = adapter && (await adapter.requestDevice());
    if (!device) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    const module = device.createShaderModule({ code: WGSL });
    const pipeline = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
    });
    return { device, pipeline, format };
  } catch {
    return null;
  }
}
function releaseGpu() {
  if (--gpuUsers > 0 || !gpu) return;
  const held = gpu;
  gpu = null;
  void held.then(g => g?.device.destroy());
}

async function webgpu(canvas: HTMLCanvasElement, app: App): Promise<Painter | null> {
  gpuUsers++;
  const g = await (gpu ??= openGpu());
  const context = g && (canvas.getContext("webgpu") as GPUCanvasContext | null);
  if (!g || !context) { releaseGpu(); return null; }
  const { device, pipeline, format } = g;
  context.configure({ device, format, alphaMode: "premultiplied" });
  const data = new Float32Array(20);
  const { deep, mid, hot } = PALETTE[app];
  data.set(deep, 8); data.set(mid, 12); data.set(hot, 16);
  const buffer = device.createBuffer({ size: data.byteLength, usage: 0x40 | 0x08 }); // UNIFORM | COPY_DST (lib.dom has no GPUBufferUsage)
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }] });
  return {
    size(w, h, pitch) { data[0] = w; data[1] = h; data[5] = pitch; },
    draw(t, level, on) {
      data[2] = t; data[3] = level; data[4] = on;
      device.queue.writeBuffer(buffer, 0, data);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    release() { context.unconfigure(); buffer.destroy(); releaseGpu(); },
  };
}

function webgl2(canvas: HTMLCanvasElement, app: App): Painter | null {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
  const program = gl && compile(gl, VERTEX, GLSL);
  if (!gl || !program) return null;
  const at = (name: string) => gl.getUniformLocation(program, name);
  for (const [name, rgb] of Object.entries(PALETTE[app])) gl.uniform3fv(at(name), rgb);
  const u = { res: at("res"), t: at("t"), level: at("level"), on: at("on"), pitch: at("pitch") };
  return {
    size(w, h, pitch) { gl.viewport(0, 0, w, h); gl.uniform2f(u.res, w, h); gl.uniform1f(u.pitch, pitch); },
    draw(t, level, on) { gl.uniform1f(u.t, t); gl.uniform1f(u.level, level); gl.uniform1f(u.on, on); gl.drawArrays(gl.TRIANGLES, 0, 3); },
    release() { gl.getExtension("WEBGL_lose_context")?.loseContext(); },
  };
}

// Chosen once per page: WebGPU's absence (or a failed adapter) drops every later glow to WebGL 2.
let choice: Renderer | null = null;
const renderer = () => (choice ??= pickRenderer({ gpu: "gpu" in navigator, webgl2: typeof WebGL2RenderingContext !== "undefined" }));

const PITCH = 2; // css px between dots

/**
 * The dithered glow behind the composer while the mic listens. Nothing is held or drawn until the mic first opens; then
 * dots rise from the bottom edge, wave and bloom with the voice (`level`, a ref: it moves many times a second), and fade
 * with `on` (a ref the composer's timeline tweens). Frames stop once it has faded, in a hidden tab, and under Reduce
 * Motion (one still frame). Without WebGPU or WebGL 2, a still dotted glow in CSS. Decorative.
 */
export function VoiceGlow({ app, live, on, level }: { app: App; live: boolean; on: RefObject<number>; level: RefObject<number> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hearing = useRef(live);
  const wake = useRef<() => void>(null);
  const [css, setCss] = useState(false);

  useEffect(() => {
    const el = canvas.current!;
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    let painter: Painter | null = null, loading = false, gone = false;
    let t = 0, env = 0, last = 0, frame = 0;

    const fit = () => {
      if (!painter) return;
      const scale = Math.min(devicePixelRatio || 1, 2);
      el.width = Math.round(el.clientWidth * scale);
      el.height = Math.round(el.clientHeight * scale);
      painter.size(el.width, el.height, PITCH * scale);
    };
    const draw = (time: number) => {
      frame = 0;
      if (!painter || document.hidden) { last = 0; return; }
      const dt = last ? Math.min(time - last, 100) : 0;
      last = time;
      env = follow(env, hearing.current ? 0.45 + 0.55 * (level.current ?? 0) : 0, dt);
      if (!still.matches) t += dt / 1000;
      painter.draw(t, still.matches ? 0.6 : env, on.current ?? 0);
      if (!still.matches && (hearing.current || (on.current ?? 0) > 0.002)) frame = requestAnimationFrame(draw);
      else last = 0;
    };
    // The first listen picks and opens a renderer (WebGPU's is async); later ones only start the loop.
    const open = async () => {
      loading = true;
      let kind = renderer();
      if (kind === "webgpu") {
        painter = await webgpu(el, app);
        if (gone) return painter?.release();
        if (!painter) kind = choice = "webgl2";
      }
      if (kind === "webgl2") painter = webgl2(el, app);
      if (!painter) { choice = "css"; setCss(true); return; }
      el.dataset.renderer = kind;
      fit();
      start();
    };
    const start = () => {
      if (gone || frame) return;
      if (painter) frame = requestAnimationFrame(draw);
      else if (!loading && hearing.current) void open();
    };
    wake.current = start;
    const resume = () => { if (hearing.current) start(); };

    const resize = new ResizeObserver(() => { fit(); resume(); });
    resize.observe(el);
    document.addEventListener("visibilitychange", resume);
    return () => {
      gone = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      document.removeEventListener("visibilitychange", resume);
      wake.current = null;
      painter?.release();
    };
  }, [app, on, level]);

  useEffect(() => {
    hearing.current = live;
    wake.current?.();
  }, [live]);

  return <canvas ref={canvas} className="voice-glow" data-fallback={css ? "" : undefined} aria-hidden="true" />;
}
