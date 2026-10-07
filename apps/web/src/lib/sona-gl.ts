// What Sona's two shaders share (components/sona-glow.tsx, components/sona-orb.tsx): ordered dithering, the palette and
// a one-triangle program. The GLSL below is valid in both WebGL 1 and WebGL 2 (`#version 300 es`) shaders.

/** Bayer 8x8 ordered dither: a threshold in [0, 1) per cell, so dots thin out evenly as the light fades. */
export const BAYER = `
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }`;

/** Lilac at the faint edge, the app's blue in the core: Sona Pro's blue, Sona Care's azure. */
export const PALETTE = {
  pro: { deep: [0.141, 0.357, 0.8], mid: [0.42, 0.46, 0.92], hot: [0.62, 0.76, 0.95] },
  care: { deep: [0.145, 0.388, 0.922], mid: [0.62, 0.52, 0.945], hot: [0.78, 0.68, 0.975] },
};

/** Links the program, makes it current and binds one triangle that covers the canvas (attribute `p`). Null if it fails. */
export function compile(gl: WebGLRenderingContext | WebGL2RenderingContext, vertex: string, fragment: string) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
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
