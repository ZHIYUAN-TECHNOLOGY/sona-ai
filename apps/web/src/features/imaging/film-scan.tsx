import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { beamAt, elapsed, SWEEP_S } from "@/lib/film-scan";
import { EASE_OUT, gsap, moves } from "@/lib/motion";
import { BAYER, BAYER_WGSL, compile } from "@/lib/sona-gl";
import { pickRenderer, type Renderer } from "@/lib/voice";

// Sona Vision reading a film, drawn over the film itself: a beam of light sweeps it top to bottom and back while the
// model reads. Behind the beam the film shows its structure (Sobel edges of the film's own pixels, in ice), Sona's Bayer
// dots settle in its near wake over the denser parts, and a quiet grid of crosses brightens where the beam passes. The
// whole film only: the read is text, so nothing here is placed on anatomy (boxes come from findings that carry one, in
// FindingMarks). The same shader twice: GLSL for WebGL 2, WGSL for WebGPU.
const GLSL = `#version 300 es
precision highp float;
uniform sampler2D film;
uniform vec2 res;
uniform float beam, wake, on, pulse, line, pitch, scale;
uniform vec3 ice, cyan, blue;
out vec4 o;
${BAYER}
float lum(vec2 uv) { return dot(texture(film, uv).rgb, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 p = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y), uv = p / res, e = 1.5 * scale / res;
  // Sobel on the film's luminance, at the scale it is shown: ribs, borders, the heart's edge.
  float tl = lum(uv - e), tc = lum(uv - vec2(0.0, e.y)), tr = lum(uv + vec2(e.x, -e.y));
  float ml = lum(uv - vec2(e.x, 0.0)), mr = lum(uv + vec2(e.x, 0.0));
  float bl = lum(uv + vec2(-e.x, e.y)), bc = lum(uv + vec2(0.0, e.y)), br = lum(uv + e);
  float edge = smoothstep(0.08, 0.5, length(vec2(tr + 2.0 * mr + br - tl - 2.0 * ml - bl, bl + 2.0 * bc + br - tl - 2.0 * tc - tr)));
  // How far behind the beam along its travel (the wake's sign is its direction), and the light it gives off.
  float d = uv.y - beam, behind = -d * sign(wake), w = max(abs(wake), 0.001);
  float trail = behind > 0.0 ? exp(-behind / w) : 0.0, near = behind > 0.0 ? exp(-behind / (w * 0.4)) : 0.0;
  float dy = d * res.y / scale;
  float core = exp(-dy * dy * 0.5) * line, bloom = exp(-d * d / (0.0016 * line * line + 0.00001)) * line;
  // The loader's dots in the near wake, denser where the film is.
  vec2 idx = floor(p / pitch), cell = (idx + 0.5) * pitch;
  float h = (near * (0.3 + 0.7 * lum(cell / res)) + bloom * 0.35) * on;
  float rad = pitch < 3.5 ? 0.62 : pitch * 0.25;
  float dots = step(bayer8(idx) * 0.86 + 0.07, h) * (1.0 - smoothstep(rad - 0.45, rad + 0.45, length(p - cell)));
  // The measuring grid: a small cross every 56 css px.
  vec2 q = abs(mod(p / scale, 56.0) - 28.0);
  float grid = max(step(q.x, 0.5) * step(q.y, 4.0), step(q.y, 0.5) * step(q.x, 4.0));
  vec3 g = cyan * edge * (0.85 * trail + 0.14 + 0.7 * pulse) * on + ice * dots * 0.55 + blue * bloom * (0.3 + 0.7 * lum(uv)) + ice * core
    + ice * grid * (0.1 + 0.5 * bloom) * on + blue * pulse * 0.1 * on;
  // Premultiplied: the glow, and behind the beam a slight dimming of the film so its structure reads.
  float a = clamp(max(max(max(g.r, g.g), g.b), 0.28 * trail * on), 0.0, 1.0);
  o = vec4(min(g, vec3(a)), a);
}`;
const VERTEX = "#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";

const WGSL = /* wgsl */ `
struct U { res: vec2f, beam: f32, wake: f32, on: f32, pulse: f32, line: f32, pitch: f32, scale: f32, ice: vec4f, cyan: vec4f, blue: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var film: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
${BAYER_WGSL}
fn lum(uv: vec2f) -> f32 { return dot(textureSampleLevel(film, smp, uv, 0.0).rgb, vec3f(0.299, 0.587, 0.114)); }
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = pos.xy; // y down from the top, as the film
  let uv = p / u.res;
  let e = 1.5 * u.scale / u.res;
  let tl = lum(uv - e); let tc = lum(uv - vec2f(0.0, e.y)); let tr = lum(uv + vec2f(e.x, -e.y));
  let ml = lum(uv - vec2f(e.x, 0.0)); let mr = lum(uv + vec2f(e.x, 0.0));
  let bl = lum(uv + vec2f(-e.x, e.y)); let bc = lum(uv + vec2f(0.0, e.y)); let br = lum(uv + e);
  let edge = smoothstep(0.08, 0.5, length(vec2f(tr + 2.0 * mr + br - tl - 2.0 * ml - bl, bl + 2.0 * bc + br - tl - 2.0 * tc - tr)));
  let d = uv.y - u.beam;
  let behind = -d * sign(u.wake);
  let w = max(abs(u.wake), 0.001);
  let trail = select(0.0, exp(-behind / w), behind > 0.0);
  let near = select(0.0, exp(-behind / (w * 0.4)), behind > 0.0);
  let dy = d * u.res.y / u.scale;
  let core = exp(-dy * dy * 0.5) * u.line;
  let bloom = exp(-d * d / (0.0016 * u.line * u.line + 0.00001)) * u.line;
  let idx = floor(p / u.pitch);
  let cell = (idx + 0.5) * u.pitch;
  let h = (near * (0.3 + 0.7 * lum(cell / u.res)) + bloom * 0.35) * u.on;
  let rad = select(u.pitch * 0.25, 0.62, u.pitch < 3.5);
  let dots = step(bayer8(idx) * 0.86 + 0.07, h) * (1.0 - smoothstep(rad - 0.45, rad + 0.45, length(p - cell)));
  let q = abs((p / u.scale) % vec2f(56.0) - 28.0);
  let grid = max(step(q.x, 0.5) * step(q.y, 4.0), step(q.y, 0.5) * step(q.x, 4.0));
  let g = u.cyan.rgb * edge * (0.85 * trail + 0.14 + 0.7 * u.pulse) * u.on + u.ice.rgb * dots * 0.55 + u.blue.rgb * bloom * (0.3 + 0.7 * lum(uv))
    + u.ice.rgb * core + u.ice.rgb * grid * (0.1 + 0.5 * bloom) * u.on + u.blue.rgb * u.pulse * 0.1 * u.on;
  let a = clamp(max(max(max(g.r, g.g), g.b), 0.28 * trail * u.on), 0.0, 1.0);
  return vec4f(min(g, vec3f(a)), a);
}`;

/** The image loader's film tone (ice and Sona blue), with a cyan between them for the film's edges. */
const ICE = [0.74, 0.9, 1.0], CYAN = [0.42, 0.82, 1.0], BLUE = [0.24, 0.47, 0.88];

type Frame = { beam: number; wake: number; on: number; pulse: number; line: number };
/** Draws one frame over the film it was made with; `size` follows the canvas; `release` lets go of what it holds. */
type Painter = { size(w: number, h: number, pitch: number, scale: number): void; draw(f: Frame): void; release(): void };

/** The film as the shader samples it: decoded from the stage's own image, at most 1280 px on its long side. */
async function filmOf(img: HTMLImageElement) {
  await img.decode();
  const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
  return createImageBitmap(img, { resizeWidth: Math.round(img.naturalWidth * k), resizeHeight: Math.round(img.naturalHeight * k), resizeQuality: "high" });
}

// A device of its own per read (a read is seconds long and rare), destroyed when the settle has played.
async function webgpu(canvas: HTMLCanvasElement, film: ImageBitmap): Promise<Painter | null> {
  try {
    const adapter = await navigator.gpu.requestAdapter();
    const device = adapter && (await adapter.requestDevice());
    if (!device) return null;
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) { device.destroy(); return null; }
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });
    const module = device.createShaderModule({ code: WGSL });
    const pipeline = await device.createRenderPipelineAsync({ layout: "auto", vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format }] } });
    // COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT, as copyExternalImageToTexture needs (lib.dom has no GPUTextureUsage).
    const texture = device.createTexture({ size: [film.width, film.height], format: "rgba8unorm", usage: 0x02 | 0x04 | 0x10 });
    device.queue.copyExternalImageToTexture({ source: film }, { texture }, [film.width, film.height]);
    const data = new Float32Array(24);
    data.set(ICE, 12); data.set(CYAN, 16); data.set(BLUE, 20);
    const buffer = device.createBuffer({ size: data.byteLength, usage: 0x40 | 0x08 }); // UNIFORM | COPY_DST
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: device.createSampler({ magFilter: "linear", minFilter: "linear" }) }, { binding: 2, resource: texture.createView() }],
    });
    return {
      size(w, h, pitch, scale) { data[0] = w; data[1] = h; data[7] = pitch; data[8] = scale; },
      draw(f) {
        data[2] = f.beam; data[3] = f.wake; data[4] = f.on; data[5] = f.pulse; data[6] = f.line;
        device.queue.writeBuffer(buffer, 0, data);
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
      },
      release() { context.unconfigure(); device.destroy(); },
    };
  } catch {
    return null;
  }
}

function webgl2(canvas: HTMLCanvasElement, film: ImageBitmap): Painter | null {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
  const program = gl && compile(gl, VERTEX, GLSL);
  if (!gl || !program) return null;
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key!, value!);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, film);
  const at = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform3fv(at("ice"), ICE); gl.uniform3fv(at("cyan"), CYAN); gl.uniform3fv(at("blue"), BLUE);
  const u = { res: at("res"), pitch: at("pitch"), scale: at("scale"), beam: at("beam"), wake: at("wake"), on: at("on"), pulse: at("pulse"), line: at("line") };
  return {
    size(w, h, pitch, scale) { gl.viewport(0, 0, w, h); gl.uniform2f(u.res, w, h); gl.uniform1f(u.pitch, pitch); gl.uniform1f(u.scale, scale); },
    draw(f) {
      gl.uniform1f(u.beam, f.beam); gl.uniform1f(u.wake, f.wake); gl.uniform1f(u.on, f.on); gl.uniform1f(u.pulse, f.pulse); gl.uniform1f(u.line, f.line);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    release() { gl.getExtension("WEBGL_lose_context")?.loseContext(); },
  };
}

// Chosen once per page: WebGPU's absence (or a failed device) drops every later scan to WebGL 2; failing that, CSS.
let choice: Renderer | null = null;
const renderer = () => (choice ??= pickRenderer({ gpu: "gpu" in navigator, webgl2: typeof WebGL2RenderingContext !== "undefined" }));

/**
 * The scan over a film while Sona Vision reads it, inside the image's own box (FilmStage), so it zooms and pans with the
 * film. Mounted when `reading` turns true; the beam sweeps down and back until it turns false, then collapses into one
 * settle pulse over the whole film, the findings' own boxes (if any) come up under it, and it unmounts: nothing is held
 * or drawn at rest. Frames come from GSAP's ticker, so they stop in a hidden tab; one still frame under Reduce Motion;
 * without WebGPU or WebGL 2 a CSS band of the house dither. The corner says what is reading and for how long.
 */
export function FilmScan({ reading }: { reading: boolean }) {
  const [shown, setShown] = useState(reading);
  if (reading && !shown) setShown(true);
  const [kind, setKind] = useState<Renderer>();
  const root = useRef<HTMLDivElement>(null);
  const live = useRef(reading);
  const settle = useRef<() => void>(null);

  useLayoutEffect(() => {
    live.current = reading;
    if (!reading) settle.current?.();
  }, [reading]);

  useEffect(() => {
    if (!shown) return;
    const el = root.current!, canvas = el.querySelector("canvas")!, clock = el.querySelector<HTMLElement>(".fs-clock")!;
    const img = el.parentElement!.querySelector("img")!;
    const moving = moves(), start = performance.now();
    const u = { phase: 0, on: 0, pulse: 0, line: 0 };
    let painter: Painter | null = null, gone = false, ended = false;

    const draw = () => painter?.draw({ ...beamAt(u.phase), on: u.on, pulse: u.pulse, line: u.line });
    const tick = () => { draw(); if (!ended) clock.textContent = elapsed(performance.now() - start); };
    const fit = () => {
      if (!painter) return;
      const scale = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * scale);
      canvas.height = Math.round(canvas.clientHeight * scale);
      painter.size(canvas.width, canvas.height, scale < 1.5 ? 3 : 5, scale);
      draw();
    };
    const done = () => { gsap.ticker.remove(tick); setShown(false); };

    // In: the frame closes on the film, the readout rises, the light comes up and the beam starts down from the top.
    // Under Reduce Motion: one still frame of the film's structure, no beam.
    const ctx = gsap.context(() => {
      if (!moving) { u.on = 1; u.pulse = 0.4; return; }
      gsap.timeline({ defaults: { ease: EASE_OUT } })
        .to(u, { on: 1, duration: 0.5 }, 0)
        .to(u, { line: 1, duration: 0.35 }, 0.05)
        .from(".fs-frame", { opacity: 0, scale: 1.03, duration: 0.45 }, 0)
        .from(".fs-read, .fs-clock", { opacity: 0, y: 4, duration: 0.35, stagger: 0.06 }, 0.1);
      gsap.to(u, { phase: 1, duration: 2 * SWEEP_S, ease: "none", repeat: -1 });
    }, el);

    // Out, when the read lands: the beam collapses into its line and goes out, one pulse over the whole film, the
    // findings' boxes come up, and the rest fades. About 0.9 s; instant under Reduce Motion.
    settle.current = () => ctx.add(() => {
      ended = true;
      gsap.killTweensOf(u, "phase");
      if (!moving) return done();
      gsap.timeline({ defaults: { ease: EASE_OUT }, onComplete: done })
        .to(u, { line: 0, duration: 0.3 }, 0)
        .to(u, { pulse: 1, duration: 0.14 }, 0.08)
        .to(u, { pulse: 0, duration: 0.6 }, 0.22)
        .to(u, { on: 0, duration: 0.6 }, 0.3)
        .from(el.parentElement!.querySelectorAll(".xr-box"), { opacity: 0, scale: 1.06, duration: 0.4, stagger: 0.06, clearProps: "opacity,transform" }, 0.15)
        .to(".fs-frame, .fs-read, .fs-clock, .fs-css", { opacity: 0, duration: 0.3 }, 0.55);
    });

    const sized = new ResizeObserver(fit);
    void (async () => {
      const film = await filmOf(img).catch(() => null);
      // Gone already (a quick read, or React's dev double mount): leave the canvas untouched, as a lost WebGL context stays lost.
      if (gone) return;
      let kind: Renderer = film ? renderer() : "css";
      if (kind === "webgpu") { painter = await webgpu(canvas, film!); if (!painter) kind = choice = "webgl2"; }
      if (kind === "webgl2") { painter = webgl2(canvas, film!); if (!painter) kind = "css"; }
      if (gone) return painter?.release();
      setKind(kind);
      fit();
      sized.observe(canvas);
      if (moving) gsap.ticker.add(tick);
    })();
    if (!live.current) settle.current();
    return () => {
      gone = true;
      gsap.ticker.remove(tick);
      ctx.revert();
      sized.disconnect();
      settle.current = null;
      painter?.release();
    };
  }, [shown]);

  if (!shown) return null;
  return (
    <div ref={root} className="fs" data-renderer={kind}>
      {kind === "css" ? <span className="fs-css" aria-hidden="true" /> : <canvas className="fs-canvas" aria-hidden="true" />}
      <span className="fs-frame" aria-hidden="true"><span /><span /><span /><span /></span>
      <span className="fs-read" role="status"><strong>Sona Vision</strong> {reading ? "reading…" : "read"}</span>
      <span className="fs-clock" aria-hidden="true" />
    </div>
  );
}
