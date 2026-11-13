/* Bubble Chamber — WebGL2 interactive particle-track visualizer.
 *
 * Pipeline per frame:
 *   CPU physics  -> bubble nucleation points (x, y, size, intensity, hue)
 *   GPU deposit  -> additive point sprites into a seed buffer
 *   GPU evolve   -> ping-pong state: nucleation -> bubble growth -> spread -> convection -> fade
 *   GPU shade    -> lit bubbles (dark-field / film / spectral / thermal) into HDR
 *   GPU bloom    -> bright pass + separable blur at half res
 *   GPU composite-> chromatic aberration, tonemap, vignette, grain
 *   2D overlay   -> emitters, targets, sources, field map, aim prediction, reconstruction, inspection
 */
(() => {
'use strict';

// ---------------------------------------------------------------- params
const P = {
  B: 1.2, density: 1.0, bubbles: 1.0, size: 1.0, growth: 1.0, persistence: 0.55, spread: 0.55, drift: 0.0,
  speed: 1.0, style: 0, bloom: 0.9, exposure: 1.35, grain: 0.05, caustics: 1.0,
  cosmics: true, pulsed: false, audio: false, showField: false, recon: false, paused: false,
  shootSpecies: 'pi-', burst: 1, brush: 0.8, brushR: 90, targetProb: 0.5, sourceType: 'mixed', sourceRate: 4,
};
const STYLES = ['dark-field', 'film', 'spectral', 'thermal'];

// ---------------------------------------------------------------- species
// m [MeV], q [e], ctau in chamber-size units (scaled for drama), hue for spectral style
const SP = {
  'e-':   { m: 0.511, q: -1, sym: 'e⁻', name: 'electron', hue: 0.55 },
  'e+':   { m: 0.511, q: 1, sym: 'e⁺', name: 'positron', hue: 0.98 },
  'mu-':  { m: 105.66, q: -1, sym: 'μ⁻', name: 'muon', hue: 0.62 },
  'mu+':  { m: 105.66, q: 1, sym: 'μ⁺', name: 'antimuon', hue: 0.08 },
  'pi+':  { m: 139.57, q: 1, sym: 'π⁺', name: 'pion', hue: 0.13, ctau: 2.4 },
  'pi-':  { m: 139.57, q: -1, sym: 'π⁻', name: 'pion', hue: 0.5, ctau: 2.4 },
  'K+':   { m: 493.68, q: 1, sym: 'K⁺', name: 'kaon', hue: 0.83, ctau: 1.1 },
  'K-':   { m: 493.68, q: -1, sym: 'K⁻', name: 'kaon', hue: 0.72, ctau: 1.1 },
  'K0':   { m: 497.61, q: 0, sym: 'K⁰', name: 'neutral kaon', ctau: 0.35 },
  'L0':   { m: 1115.7, q: 0, sym: 'Λ⁰', name: 'lambda', ctau: 0.45 },
  'p':    { m: 938.27, q: 1, sym: 'p', name: 'proton', hue: 0.33 },
  'pbar': { m: 938.27, q: -1, sym: 'p̄', name: 'antiproton', hue: 0.9 },
  'alpha':{ m: 3727.4, q: 2, sym: 'α', name: 'alpha', hue: 0.04 },
  'gamma':{ m: 0, q: 0, sym: 'γ', name: 'photon' },
};
const BEAM_MIX = [['pi-', 30], ['pi+', 16], ['K-', 12], ['K+', 8], ['p', 14], ['pbar', 7], ['e-', 7], ['mu-', 6]];
const SHOOTABLE = ['pi-', 'pi+', 'K-', 'K+', 'p', 'pbar', 'e-', 'e+', 'mu-', 'mu+', 'alpha', 'gamma', 'K0', 'L0', 'mix'];
const symOf = k => k === 'mix' ? 'mix' : SP[k].sym;

// ---------------------------------------------------------------- utils
const rand = Math.random;
const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185 * v); };
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const pick = list => { let t = 0; for (const [, w] of list) t += w; let r = rand() * t; for (const [k, w] of list) { if ((r -= w) <= 0) return k; } return list[0][0]; };
const $ = s => document.querySelector(s);
const fmtP = p => p >= 1000 ? (p / 1000).toFixed(2) + ' GeV/c' : p.toFixed(p < 10 ? 2 : 0) + ' MeV/c';
const fmtE = e => e >= 1000 ? (e / 1000).toFixed(2) + ' GeV' : e.toFixed(e < 10 ? 2 : 1) + ' MeV';

// ---------------------------------------------------------------- GL setup
const glc = $('#gl'), uic = $('#ui');
const gl = glc.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
if (!gl) { $('#nogl').hidden = false; return; }
const ctx = uic.getContext('2d');
const hasFloat = !!gl.getExtension('EXT_color_buffer_float');
gl.getExtension('OES_texture_float_linear');
const FMT = hasFloat ? { i: gl.RGBA16F, t: gl.HALF_FLOAT } : { i: gl.RGBA8, t: gl.UNSIGNED_BYTE };

function shader(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  return s;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}
function target(w, h, filter = gl.LINEAR) {
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, FMT.i, w, h, 0, gl.RGBA, FMT.t, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fbo, w, h };
}
function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }

const GLSL_COMMON = `#version 300 es
precision highp float;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
`;
const VS_FULL = `#version 300 es
out vec2 vUv;
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUv = p; gl_Position = vec4(p*2.-1., 0., 1.); }`;

const VS_DEPOSIT = `#version 300 es
layout(location=0) in vec2 aPos; layout(location=1) in vec3 aData;
uniform vec2 uCss;
out float vI; out float vH;
void main(){ vec2 c = aPos/uCss*2.-1.; c.y = -c.y; gl_Position = vec4(c, 0., 1.); gl_PointSize = aData.x; vI = aData.y; vH = aData.z; }`;
const FS_DEPOSIT = `#version 300 es
precision highp float;
in float vI; in float vH; out vec4 o;
void main(){ vec2 d = gl_PointCoord*2.-1.; float r2 = dot(d,d); if(r2>1.) discard; float a = 1.-r2; a*=a; o = vec4(a*vI, a*vI*vH, 0., 0.); }`;

const FS_EVOLVE = GLSL_COMMON + `
in vec2 vUv; out vec4 o;
uniform sampler2D uPrev, uSeed; uniform vec2 uTexel; uniform float uAspect, uGrowth, uFade, uSpread, uDrift, uTime, uWipe;
void main(){
  vec2 uv = vUv;
  if(uDrift > 0.){
    vec2 q = uv*vec2(uAspect,1.)*2.2 + vec2(0., uTime*.02); float e = .02;
    float nx = noise(q+vec2(0.,e)) - noise(q-vec2(0.,e));
    float ny = noise(q+vec2(e,0.)) - noise(q-vec2(e,0.));
    vec2 curl = vec2(nx, -ny)/(2.*e);
    uv -= (curl*0.6 + vec2(0., -0.25))*uDrift*uTexel;   // convection + slow rise
  }
  vec4 c = texture(uPrev, uv);
  vec4 a = texture(uPrev, uv+vec2(uTexel.x,0.)), b = texture(uPrev, uv-vec2(uTexel.x,0.));
  vec4 d = texture(uPrev, uv+vec2(0.,uTexel.y)), e2 = texture(uPrev, uv-vec2(0.,uTexel.y));
  float R = c.r, hue = c.g, pend = c.b;
  float navg = (a.r+b.r+d.r+e2.r)*.25;
  float grown = max(R, navg*uSpread);
  if(grown > R + 1e-4){ float w = a.r+b.r+d.r+e2.r; hue = (a.g*a.r+b.g*b.r+d.g*d.r+e2.g*e2.r)/max(w,1e-4); }
  vec4 s = texture(uSeed, vUv);
  float add = s.r*uGrowth;
  pend += add;
  float tr = pend*0.22;                  // nucleation -> visible bubble growth over a few frames
  pend -= tr;
  float Rn = grown + tr;
  hue = mix(hue, s.g/max(s.r,1e-4), clamp(add/max(Rn+add,1e-4),0.,1.));
  Rn *= uFade*(1.-uWipe); pend *= (1.-uWipe);
  o = vec4(min(Rn, 5.), hue, min(pend, 8.), 1.);
}`;

const FS_SHADE = GLSL_COMMON + `
in vec2 vUv; out vec4 o;
uniform sampler2D uState; uniform vec2 uTexel; uniform float uAspect, uTime, uFlash, uCaustics; uniform int uStyle;
vec3 hsv(float h,float s,float v){ vec3 k = clamp(abs(fract(h+vec3(0.,2./3.,1./3.))*6.-3.)-1.,0.,1.); return v*mix(vec3(1.),k,s); }
vec3 inferno(float t){
  const vec3 c0=vec3(0.00021894,0.00165100,-0.01948090), c1=vec3(0.10651342,0.56395644,3.93271239), c2=vec3(11.60249308,-3.97285397,-15.94239411),
  c3=vec3(-41.70399613,17.43639888,44.35414520), c4=vec3(77.16293570,-33.40235894,-81.80730926), c5=vec3(-71.31942824,32.62606426,73.20951986), c6=vec3(25.13112622,-12.24266895,-23.07032500);
  return c0+t*(c1+t*(c2+t*(c3+t*(c4+t*(c5+t*c6))))); }
float R(vec2 uv){ return texture(uState, uv).r; }
void main(){
  vec2 uv = vUv; vec4 s = texture(uState, uv); float r = s.r;
  vec2 g = vec2(R(uv+vec2(uTexel.x,0.))-R(uv-vec2(uTexel.x,0.)), R(uv+vec2(0.,uTexel.y))-R(uv-vec2(0.,uTexel.y)));
  float gm = length(g);
  float body = smoothstep(0.05, 0.75, r);
  float rim = smoothstep(0.02, 0.45, gm);
  vec3 N = normalize(vec3(-g*2.6, 1.));
  vec3 H = normalize(normalize(vec3(-.45,.55,.7)) + vec3(0.,0.,1.));
  float spec = pow(max(dot(N,H),0.), 42.)*body;
  vec2 p = (uv-.5)*vec2(uAspect,1.);
  float d = pow(pow(abs(p.x)/(uAspect*.5*.965),4.)+pow(abs(p.y)/(.5*.955),4.),.25);
  float px = uTexel.y*1.5;
  float win = smoothstep(1.0, 1.0-px*2., d);
  float t = uTime*.035;
  float cz = noise(p*5.+vec2(t,t*.7))*noise(p*9.-vec2(t*1.3,t*.4)+3.);
  cz = pow(cz, 1.6)*uCaustics;
  vec2 fc = (fract(p/.2+.5)-.5)*.2;
  float cr = max((1.-smoothstep(0.,px,abs(fc.x)))*step(abs(fc.y),.011), (1.-smoothstep(0.,px,abs(fc.y)))*step(abs(fc.x),.011));
  float glow = exp(-dot(p,p)*2.2);
  vec3 col;
  if(uStyle==0){
    vec3 bg = vec3(.010,.026,.034) + vec3(.025,.07,.08)*cz + vec3(.012,.03,.035)*glow;
    col = bg + vec3(.72,.93,1.)*(.22*body + 1.55*rim*body + .35*rim) + vec3(1.)*spec*2.2;
    col += vec3(.25,.45,.5)*cr*.32;
  } else if(uStyle==1){
    vec3 paper = vec3(.80,.77,.70)*(.78+.22*glow) + cz*.06;
    float dark = clamp(.85*body + .55*rim, 0., 1.);
    col = paper*(1.-dark) + vec3(.9)*spec*.5*body;
    col *= 1.-cr*.55;
  } else if(uStyle==2){
    vec3 h = hsv(s.g, .78, 1.);
    vec3 bg = vec3(.008,.012,.024) + vec3(.03,.03,.06)*cz + vec3(.01,.01,.025)*glow;
    col = bg + h*(.3*body + 1.5*rim*body + .3*rim)*1.25 + h*spec*1.6;
    col += vec3(.35,.3,.55)*cr*.25;
  } else {
    vec3 bg = vec3(.012,.004,.03) + vec3(.03,.01,.05)*cz;
    col = bg + inferno(clamp(.18+sqrt(r)*.62, 0., 1.))*smoothstep(.02,.12,r)*1.3 + spec*.6;
    col += vec3(.4,.2,.5)*cr*.22;
  }
  vec3 frame = vec3(.022,.026,.028)*(.7+.3*noise(vec2(p.x*400., p.y*3.)));
  float lip = smoothstep(1.0-px*14., 1.0, d)*win;
  col += lip*(uStyle==1 ? vec3(-.15) : vec3(.05,.09,.1));
  col = mix(frame, col, win);
  col *= 1. + uFlash*.9;
  o = vec4(col, 1.);
}`;

const FS_BRIGHT = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform float uThresh;
void main(){ vec3 c = texture(uSrc, vUv).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c*max(l-uThresh,0.)/max(l,1e-4), 1.); }`;
const FS_BLUR = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform vec2 uDir;
void main(){ vec3 c = texture(uSrc, vUv).rgb*.227;
  c += (texture(uSrc, vUv+uDir*1.385).rgb + texture(uSrc, vUv-uDir*1.385).rgb)*.316;
  c += (texture(uSrc, vUv+uDir*3.231).rgb + texture(uSrc, vUv-uDir*3.231).rgb)*.070; o = vec4(c, 1.); }`;
const FS_COMPOSITE = GLSL_COMMON + `
in vec2 vUv; out vec4 o; uniform sampler2D uHdr, uBloom; uniform float uBloomAmt, uExposure, uGrain, uTime; uniform vec2 uRes;
void main(){
  vec2 dc = vUv-.5; vec2 ca = dc*.0035;
  vec3 c = vec3(texture(uHdr, vUv-ca).r, texture(uHdr, vUv).g, texture(uHdr, vUv+ca).b);
  c += texture(uBloom, vUv).rgb*uBloomAmt;
  c = 1.-exp(-c*uExposure);
  c *= 1.-dot(dc,dc)*.55;
  c += (hash(vUv*uRes + fract(uTime*7.1)*91.) - .5)*uGrain;
  o = vec4(c, 1.);
}`;

const prg = {
  deposit: program(VS_DEPOSIT, FS_DEPOSIT), evolve: program(VS_FULL, FS_EVOLVE), shade: program(VS_FULL, FS_SHADE),
  bright: program(VS_FULL, FS_BRIGHT), blur: program(VS_FULL, FS_BLUR), composite: program(VS_FULL, FS_COMPOSITE),
};
const emptyVao = gl.createVertexArray();

// deposit buffer: x, y, size, intensity, hue
const MAXB = 120000;
const bubbleData = new Float32Array(MAXB * 5);
let nBub = 0;
const bubVao = gl.createVertexArray(), bubBuf = gl.createBuffer();
gl.bindVertexArray(bubVao); gl.bindBuffer(gl.ARRAY_BUFFER, bubBuf);
gl.bufferData(gl.ARRAY_BUFFER, bubbleData.byteLength, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 8);
gl.bindVertexArray(null);

// ---------------------------------------------------------------- sizing
let W = 0, H = 0, S = 1, DPR = 1, simScale = 1, RW = 0, RH = 0;
let stA, stB, seed, hdr, bl1, bl2;
function resize() {
  W = innerWidth; H = innerHeight; S = Math.min(W, H);
  DPR = Math.min(devicePixelRatio || 1, 2);
  simScale = Math.min(DPR, 2600 / Math.max(W, H));
  RW = Math.round(W * simScale); RH = Math.round(H * simScale);
  glc.width = RW; glc.height = RH;
  uic.width = Math.round(W * DPR); uic.height = Math.round(H * DPR);
  [stA, stB, seed, hdr, bl1, bl2].forEach(freeTarget);
  stA = target(RW, RH); stB = target(RW, RH); seed = target(RW, RH); hdr = target(RW, RH);
  bl1 = target(RW >> 1, RH >> 1); bl2 = target(RW >> 1, RH >> 1);
  field.resize();
}

// ---------------------------------------------------------------- chamber geometry
function inWindow(x, y) {
  const px = (x / W - .5) * (W / H), py = (y / H - .5);
  const a = W / H * .5 * .965, b = .5 * .955;
  return Math.pow(Math.pow(Math.abs(px) / a, 4) + Math.pow(Math.abs(py) / b, 4), .25) < 0.995;
}
// project a point onto the window boundary along a ray from centre (used to seat emitters at the edge)
function edgePoint(ang, inset = 18) {
  let lo = 0, hi = Math.max(W, H);
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; inWindow(W / 2 + Math.cos(ang) * m, H / 2 + Math.sin(ang) * m) ? lo = m : hi = m; }
  return [W / 2 + Math.cos(ang) * (lo - inset), H / 2 + Math.sin(ang) * (lo - inset)];
}

// ---------------------------------------------------------------- magnetic field layer
const field = {
  cell: 36, gw: 0, gh: 0, g: new Float32Array(0),
  resize() { this.gw = Math.ceil(W / this.cell) + 2; this.gh = Math.ceil(H / this.cell) + 2; this.g = new Float32Array(this.gw * this.gh); },
  at(x, y) {
    const fx = clamp(x / this.cell, 0, this.gw - 1.001), fy = clamp(y / this.cell, 0, this.gh - 1.001);
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, g = this.g, w = this.gw, i = iy * w + ix;
    return P.B + (g[i] * (1 - tx) + g[i + 1] * tx) * (1 - ty) + (g[i + w] * (1 - tx) + g[i + w + 1] * tx) * ty;
  },
  paint(x, y, amt, r) {
    const c = this.cell, rr = Math.ceil(r * 2 / c);
    const cx = Math.round(x / c), cy = Math.round(y / c);
    for (let j = cy - rr; j <= cy + rr; j++) for (let i = cx - rr; i <= cx + rr; i++) {
      if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) continue;
      const dx = i * c - x, dy = j * c - y;
      const k = j * this.gw + i; this.g[k] = clamp(this.g[k] + amt * Math.exp(-(dx * dx + dy * dy) / (2 * r * r)), -4, 4);
    }
  },
  clear() { this.g.fill(0); },
};

// ---------------------------------------------------------------- physics
const MAXP = 2600, STEP = 0.9;
const K_LOSS = 5.0;          // MeV per chamber-size for minimum-ionising |q|=1
const CURV = 330;            // r_px = p * S / (CURV * |q| * B)
const particles = [];
const tracks = [];
let trackId = 0, bubblesThisSec = 0, bubRate = 0, simTime = 0, sens = 1, flash = 0, wipe = 0;

function newTrack(sp, parent, x, y, p) {
  const t = { id: ++trackId, sp, parent, kids: [], pts: [x, y], p0: p, born: simTime, died: 0, end: '', len: 0, alive: true };
  if (parent) parent.kids.push(t);
  tracks.push(t);
  return t;
}
function spawn(sp, x, y, dx, dy, p, parent = null) {
  if (particles.length >= MAXP || !(p > 0)) return null;
  const s = SP[sp], l = Math.hypot(dx, dy) || 1;
  const E = Math.sqrt(p * p + s.m * s.m);
  const o = { sp, s, x, y, dx: dx / l, dy: dy / l, p, E, beta: s.m ? p / E : 1, acc: rand(), ptAcc: 0, alive: true, hit: null };
  o.track = newTrack(sp, parent, x, y, p);
  particles.push(o);
  return o;
}
function spawnVec(sp, x, y, px, py, parent) { return spawn(sp, x, y, px, py, Math.hypot(px, py), parent); }

// two-body decay M -> m1 m2 in the parent's direction (2D projection)
function twoBody(o, M, m1, m2) {
  const ps = Math.sqrt(Math.max(0, (M * M - (m1 + m2) ** 2) * (M * M - (m1 - m2) ** 2))) / (2 * M);
  const th = rand() * 6.283185, ppar = ps * Math.cos(th), pperp = ps * Math.sin(th);
  const E = Math.sqrt(o.p * o.p + M * M), g = E / M, bg = o.p / M;
  const e1 = Math.sqrt(ps * ps + m1 * m1), e2 = Math.sqrt(ps * ps + m2 * m2);
  const a1 = g * ppar + bg * e1, a2 = -g * ppar + bg * e2;
  const nx = -o.dy, ny = o.dx;
  return [[o.dx * a1 + nx * pperp, o.dy * a1 + ny * pperp], [o.dx * a2 - nx * pperp, o.dy * a2 - ny * pperp]];
}
function atRest(o) { o.p = 0; return o; }

function kill(o, why) {
  if (!o.alive) return;
  o.alive = false; o.track.alive = false; o.track.died = simTime; o.track.end = why;
  o.track.pts.push(o.x, o.y);
}

function logEvent(html) {
  const el = document.createElement('div'); el.innerHTML = html;
  const log = $('#log'); log.prepend(el);
  while (log.children.length > 7) log.lastChild.remove();
  [...log.children].forEach((c, i) => c.classList.toggle('old', i > 3));
}

function decay(o, inFlight) {
  const { sp, x, y } = o, t = o.track;
  const M = o.s.m;
  if (!inFlight) atRest(o);
  let txt = '';
  switch (sp) {
    case 'pi+': case 'pi-': {
      if (sp === 'pi-' && !inFlight) { nuclearStar(o, 'capture'); return; }
      const [a] = twoBody(o, M, 105.66, 0);
      spawnVec(sp === 'pi+' ? 'mu+' : 'mu-', x, y, a[0], a[1], t);
      txt = `${o.s.sym} → <em>${sp === 'pi+' ? 'μ⁺' : 'μ⁻'}</em> ν`; break;
    }
    case 'mu+': case 'mu-': {
      const pe = 10 + 42.8 * Math.sqrt(rand()), th = rand() * 6.283;
      spawn(sp === 'mu+' ? 'e+' : 'e-', x, y, Math.cos(th), Math.sin(th), pe, t);
      txt = `${o.s.sym} → <em>${sp === 'mu+' ? 'e⁺' : 'e⁻'}</em> ν ν̄`; break;
    }
    case 'K+': case 'K-': {
      const ch = sp === 'K+' ? '+' : '-';
      if (sp === 'K-' && !inFlight) {
        const [a, b] = twoBody(o, M, 1115.7, 139.57);
        spawnVec('pi-', x, y, b[0], b[1], t); spawnVec('L0', x, y, a[0], a[1], t);
        txt = `K⁻p → <em>Λ⁰ π⁻</em>`; break;
      }
      if (rand() < 0.64) {
        const [a] = twoBody(o, M, 105.66, 0);
        spawnVec('mu' + ch, x, y, a[0], a[1], t); txt = `${o.s.sym} → <em>μ${ch === '+' ? '⁺' : '⁻'}</em> ν`;
      } else {
        const [a, b] = twoBody(o, M, 139.57, 134.98);
        spawnVec('pi' + ch, x, y, a[0], a[1], t);
        pi0(x, y, b[0], b[1], t); txt = `${o.s.sym} → <em>π${ch === '+' ? '⁺' : '⁻'} π⁰</em>`;
      }
      break;
    }
    case 'K0': { const [a, b] = twoBody(o, M, 139.57, 139.57); spawnVec('pi+', x, y, a[0], a[1], t); spawnVec('pi-', x, y, b[0], b[1], t); txt = `K⁰ → <em>π⁺ π⁻</em> (V⁰)`; break; }
    case 'L0': { const [a, b] = twoBody(o, M, 938.27, 139.57); spawnVec('p', x, y, a[0], a[1], t); spawnVec('pi-', x, y, b[0], b[1], t); txt = `Λ⁰ → <em>p π⁻</em> (V⁰)`; break; }
    case 'e+': { const th = rand() * 6.283; spawn('gamma', x, y, Math.cos(th), Math.sin(th), 0.511, t); spawn('gamma', x, y, -Math.cos(th), -Math.sin(th), 0.511, t); txt = `e⁺e⁻ → <em>γγ</em> annihilation`; break; }
    case 'pbar': nuclearStar(o, 'annihilation'); return;
    default: return;
  }
  kill(o, inFlight ? 'decay' : 'decay at rest');
  if (txt) { logEvent(txt); audio.ping(sp); }
}
function pi0(x, y, px, py, parent) {
  const fake = { p: Math.hypot(px, py), dx: px, dy: py }; const l = fake.p || 1; fake.dx /= l; fake.dy /= l;
  const [a, b] = twoBody(fake, 134.98, 0, 0);
  spawnVec('gamma', x, y, a[0], a[1], parent); spawnVec('gamma', x, y, b[0], b[1], parent);
}
function pair(o) {
  const avail = o.E - 1.022; if (avail <= 0) return;
  const f = 0.08 + 0.84 * rand(), open = 0.02 + 0.07 * rand();
  const ca = Math.cos(open), sa = Math.sin(open);
  const p1 = Math.sqrt((f * avail + .511) ** 2 - .261), p2 = Math.sqrt(((1 - f) * avail + .511) ** 2 - .261);
  spawn('e-', o.x, o.y, o.dx * ca - o.dy * sa, o.dy * ca + o.dx * sa, p1, o.track);
  spawn('e+', o.x, o.y, o.dx * ca + o.dy * sa, o.dy * ca - o.dx * sa, p2, o.track);
  kill(o, 'pair conversion'); logEvent(`γ → <em>e⁺ e⁻</em> ${fmtE(o.E)}`); audio.ping('pair');
}
function nuclearStar(o, kind) {
  const Tin = kind === 'annihilation' ? 1876 + (o.E - o.s.m) : kind === 'capture' ? 140 : Math.max(60, (o.E - o.s.m) * 0.85);
  const n = clamp(2 + Math.floor(rand() * (1 + Tin / 220)), 2, 10);
  const mix = kind === 'annihilation'
    ? [['pi+', 40], ['pi-', 40], ['gamma', 20]]
    : Tin < 200 ? [['p', 60], ['alpha', 20], ['gamma', 20]]
    : [['p', 34], ['pi+', 18], ['pi-', 18], ['gamma', 10], ['K0', 6], ['L0', 6], ['K+', 4], ['alpha', 4]];
  const w = []; let tw = 0; for (let i = 0; i < n; i++) { const r = -Math.log(rand() + 1e-6); w.push(r); tw += r; }
  const fwd = Math.atan2(o.dy, o.dx), spread = kind === 'interaction' ? 0.9 : 3.2;
  for (let i = 0; i < n; i++) {
    const sp = pick(mix), m = SP[sp].m, T = Tin * w[i] / tw;
    const p = m ? Math.sqrt(T * T + 2 * T * m) : T;
    const a = fwd + (kind === 'interaction' ? gauss() * spread : rand() * 6.283);
    spawn(sp, o.x, o.y, Math.cos(a), Math.sin(a), Math.max(p, 5), o.track);
  }
  kill(o, kind === 'interaction' ? 'nuclear interaction' : kind);
  logEvent(`${o.s.sym} ${kind} · <em>${n}-prong star</em>`); audio.star(n);
}

function emitBubble(x, y, ion, hue) {
  if (nBub >= MAXB) return;
  const j = 0.55, k = nBub * 5;
  bubbleData[k] = x + gauss() * j; bubbleData[k + 1] = y + gauss() * j;
  bubbleData[k + 2] = Math.max(1.6, (1.15 + 0.2 * Math.sqrt(Math.min(ion, 30))) * simScale * P.size * (0.75 + 0.5 * rand()));
  bubbleData[k + 3] = (0.65 + 0.5 * rand()) / (1 + ion * 0.04);
  bubbleData[k + 4] = hue;
  nBub++; bubblesThisSec++;
}

function stepParticle(o, f) {
  const s = o.s, q = s.q;
  let budget = 14 * P.speed * f * Math.max(o.beta, 0.12);
  while (budget > 0 && o.alive) {
    const ds = Math.min(STEP, budget); budget -= ds;
    const dsS = ds / S;
    if (q !== 0) {
      const B = field.at(o.x, o.y);
      let dth = -q * B * ds * CURV / (o.p * S);
      dth += gauss() * 2.0 * Math.abs(q) / (o.beta * o.p) * Math.sqrt(dsS) * P.density;
      if (Math.abs(dth) > 0.5) { stop(o); return; }
      const c = Math.cos(dth), sn = Math.sin(dth), nx = o.dx * c - o.dy * sn; o.dy = o.dy * c + o.dx * sn; o.dx = nx;
      const ib = Math.min(1 / (o.beta * o.beta), 30);
      const ion = q * q * ib;
      // low-energy electrons lose energy faster (multiple scattering + range straggling) so delta rays curl a few turns, not dozens
      o.E -= K_LOSS * P.density * ion * dsS * (s.m < 1 ? 1 + 6 / Math.max(o.p, 0.5) : 1);
      if (o.E - s.m <= (s.m < 1 ? 0.04 : 0.6)) { o.x += o.dx * ds; o.y += o.dy * ds; stop(o); return; }
      o.p = Math.sqrt(o.E * o.E - s.m * s.m); o.beta = o.p / o.E;
      o.acc += 0.38 * P.bubbles * Math.min(ion, 9) * ds * sens;
      while (o.acc >= 1) { o.acc -= 1; emitBubble(o.x + o.dx * rand() * ds, o.y + o.dy * rand() * ds, ion, s.hue); }
      // delta ray (knock-on electron)
      if (o.p > 25 && rand() < 2.2 * q * q * dsS * P.density) {
        const pd = 0.5 + 6 * rand() * rand(), side = rand() < .5 ? 1 : -1, a = side * (1.0 + 0.45 * rand());
        const ca = Math.cos(a), sa = Math.sin(a);
        spawn('e-', o.x, o.y, o.dx * ca - o.dy * sa, o.dy * ca + o.dx * sa, pd, o.track);
        o.E -= pd * .3;
      }
      // bremsstrahlung for e±
      if (s.m < 1 && o.p > 6 && rand() < 0.9 * dsS * P.density) {
        const k = o.E * (0.08 + 0.45 * rand());
        spawn('gamma', o.x, o.y, o.dx, o.dy, k, o.track);
        o.E -= k; if (o.E - s.m <= 0.05) { stop(o); return; }
        o.p = Math.sqrt(o.E * o.E - s.m * s.m); o.beta = o.p / o.E;
      }
    } else if (s.m === 0) {
      if (o.E > 1.03 && rand() < dsS * 0.75 * P.density) { pair(o); return; }
    }
    if (s.ctau && rand() < dsS / ((o.p / s.m) * s.ctau)) { decay(o, true); return; }
    o.x += o.dx * ds; o.y += o.dy * ds;
    o.track.len += ds;
    if ((o.ptAcc += ds) > 3) { o.ptAcc = 0; o.track.pts.push(o.x, o.y); }
    if (!inWindow(o.x, o.y)) { kill(o, 'left chamber'); return; }
    for (const tg of targets) {
      const dx = o.x - tg.x, dy = o.y - tg.y;
      if (dx * dx + dy * dy < tg.r * tg.r && o.hit !== tg) {
        o.hit = tg;
        if (s.m > 100 && rand() < P.targetProb) { nuclearStar(o, 'interaction'); return; }
        if (s.m === 0 && o.E > 1.03 && rand() < P.targetProb) { pair(o); return; }
      }
    }
  }
}
function stop(o) {
  const sp = o.sp;
  if (sp === 'pi+' || sp === 'pi-' || sp === 'mu+' || sp === 'mu-' || sp === 'K+' || sp === 'K-' || sp === 'e+' || sp === 'pbar') decay(o, false);
  else kill(o, 'stopped');
}

// ---------------------------------------------------------------- scene objects (interaction layers)
const emitters = [], targets = [], sources = [];
let emId = 0;
function addEmitter(ang, sp = 'mix', p = 900, rate = 1.4) {
  const [x, y] = edgePoint(ang);
  const e = { id: ++emId, x, y, a: ang + Math.PI, sp, p, rate, acc: 0, rx: (x / W), ry: (y / H) };
  emitters.push(e); buildEmitterUI(); return e;
}
function fireEmitter(e, n = 1) {
  for (let i = 0; i < n; i++) {
    const sp = e.sp === 'mix' ? pick(BEAM_MIX) : e.sp;
    const a = e.a + gauss() * 0.012, off = gauss() * 5;
    spawn(sp, e.x - Math.sin(e.a) * off, e.y + Math.cos(e.a) * off, Math.cos(a), Math.sin(a), e.p * (1 + gauss() * 0.03));
  }
}
function cosmic() {
  // enter through the top of the window, mostly downward
  const a = Math.PI / 2 + gauss() * 0.35;
  let px = W * (0.1 + 0.8 * rand()), py = 0;
  for (let i = 0; i < 400 && !inWindow(px, py); i++) { px += Math.cos(a) * 4; py += Math.sin(a) * 4; }
  if (!inWindow(px, py)) return;
  const sp = rand() < .55 ? 'mu-' : 'mu+';
  spawn(sp, px, py, Math.cos(a), Math.sin(a), 400 + 3000 * rand() * rand());
}
function sourceEmit(src) {
  const type = src.type === 'mixed' ? (rand() < .65 ? 'beta' : 'alpha') : src.type;
  const a = rand() * 6.283;
  if (type === 'alpha') { const T = 4 + 5 * rand(); spawn('alpha', src.x, src.y, Math.cos(a), Math.sin(a), Math.sqrt(T * T + 2 * T * 3727.4)); }
  else { const T = 0.3 + 4 * rand() * rand(); spawn(rand() < .8 ? 'e-' : 'e+', src.x, src.y, Math.cos(a), Math.sin(a), Math.sqrt(T * T + 2 * T * .511)); }
}
function spark(x, y) {
  // tap on the chamber: a random photon conversion / star / V0 born at that point
  const r = rand(), a = rand() * 6.283;
  const fake = { x, y, dx: Math.cos(a), dy: Math.sin(a), s: SP.p, E: 1600, sp: 'p', track: newTrack('p', null, x, y, 0), alive: true };
  if (r < 0.35) { const g = spawn('gamma', x, y, fake.dx, fake.dy, 20 + 200 * rand()); if (g) pair(g); }
  else if (r < 0.6) { const k = spawn(rand() < .5 ? 'K0' : 'L0', x, y, fake.dx, fake.dy, 300 + 500 * rand()); if (k) decay(k, true); }
  else nuclearStar(fake, 'interaction');
  tracks.splice(tracks.indexOf(fake.track), 1);
}

// ---------------------------------------------------------------- pulsed expansion cycle
const CYCLE = 3.2;
let cyclePhase = 0, flashed = false;
function updateCycle(dt) {
  if (!P.pulsed) { sens = 1; wipe = 0; flash *= 0.85; return; }
  cyclePhase = (cyclePhase + dt / CYCLE) % 1;
  const ph = cyclePhase;
  sens = ph < 0.22 ? 1 : 0.0;
  if (ph < 0.02) flashed = false;
  if (ph > 0.06 && !flashed) { flashed = true; flash = 1; for (const e of emitters) fireEmitter(e, 2 + Math.round(e.rate * 2)); audio.thump(); }
  flash *= 0.86;
  wipe = ph > 0.78 && ph < 0.9 ? 0.06 : 0;
}

// ---------------------------------------------------------------- simulation tick
let lastPrune = 0;
function simulate(dt) {
  const f = Math.min(dt * 60, 3);
  simTime += dt;
  updateCycle(dt);
  if (!P.pulsed) for (const e of emitters) { e.acc += e.rate * dt; while (e.acc >= 1) { e.acc -= 1; fireEmitter(e); } }
  if (P.cosmics && rand() < dt * 0.45) cosmic();
  for (const s of sources) { s.acc += P.sourceRate * dt; while (s.acc >= 1) { s.acc -= 1; sourceEmit(s); } }
  for (let i = 0; i < particles.length; i++) stepParticle(particles[i], f);
  for (let i = particles.length - 1; i >= 0; i--) if (!particles[i].alive) { particles[i] = particles[particles.length - 1]; particles.pop(); }
  if (simTime - lastPrune > 0.5) {
    lastPrune = simTime;
    const fade = fadeRate(), life = Math.log(0.04) / Math.log(fade) / 60 + 0.5;
    for (let i = tracks.length - 1; i >= 0; i--) { const t = tracks[i]; if (!t.alive && simTime - t.died > life && t !== pinned) tracks.splice(i, 1); }
    while (tracks.length > 2500) { const i = tracks.findIndex(t => !t.alive && t !== pinned); if (i < 0) break; tracks.splice(i, 1); }
  }
}
const fadeRate = () => 1 - (0.03 * Math.pow(0.012, P.persistence));

// ---------------------------------------------------------------- render
function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
function pass(pr, dst, fn) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fbo : null);
  gl.viewport(0, 0, dst ? dst.w : RW, dst ? dst.h : RH);
  gl.useProgram(pr.p); fn(pr.u);
  gl.bindVertexArray(emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
}
let snapRequested = false;
function render(time) {
  // 1. deposit nucleation sites
  gl.bindFramebuffer(gl.FRAMEBUFFER, seed.fbo); gl.viewport(0, 0, RW, RH);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  if (nBub) {
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(prg.deposit.p); gl.uniform2f(prg.deposit.u.uCss, W, H);
    gl.bindVertexArray(bubVao); gl.bindBuffer(gl.ARRAY_BUFFER, bubBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, bubbleData, 0, nBub * 5);
    gl.drawArrays(gl.POINTS, 0, nBub);
    gl.disable(gl.BLEND); nBub = 0;
  }
  // 2. evolve bubble state
  const tex = [1 / RW, 1 / RH];
  pass(prg.evolve, stB, u => {
    bindTex(0, stA.tex); bindTex(1, seed.tex);
    gl.uniform1i(u.uPrev, 0); gl.uniform1i(u.uSeed, 1); gl.uniform2f(u.uTexel, ...tex);
    gl.uniform1f(u.uAspect, W / H); gl.uniform1f(u.uGrowth, P.growth * (hasFloat ? 1 : .5));
    gl.uniform1f(u.uFade, P.paused ? 1 : fadeRate()); gl.uniform1f(u.uSpread, P.spread * 0.92);
    gl.uniform1f(u.uDrift, P.paused ? 0 : P.drift); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uWipe, P.paused ? 0 : wipe);
  });
  [stA, stB] = [stB, stA];
  // 3. shade
  pass(prg.shade, hdr, u => {
    bindTex(0, stA.tex); gl.uniform1i(u.uState, 0); gl.uniform2f(u.uTexel, ...tex);
    gl.uniform1f(u.uAspect, W / H); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uFlash, flash);
    gl.uniform1f(u.uCaustics, P.caustics); gl.uniform1i(u.uStyle, P.style);
  });
  // 4. bloom
  if (P.bloom > 0) {
    pass(prg.bright, bl1, u => { bindTex(0, hdr.tex); gl.uniform1i(u.uSrc, 0); gl.uniform1f(u.uThresh, P.style === 1 ? 0.95 : 0.45); });
    for (let i = 0; i < 2; i++) {
      const k = 1 + i * 1.5;
      pass(prg.blur, bl2, u => { bindTex(0, bl1.tex); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uDir, k / bl1.w, 0); });
      pass(prg.blur, bl1, u => { bindTex(0, bl2.tex); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uDir, 0, k / bl1.h); });
    }
  }
  // 5. composite
  pass(prg.composite, null, u => {
    bindTex(0, hdr.tex); bindTex(1, bl1.tex); gl.uniform1i(u.uHdr, 0); gl.uniform1i(u.uBloom, 1);
    gl.uniform1f(u.uBloomAmt, P.bloom > 0 ? P.bloom : 0); gl.uniform1f(u.uExposure, P.exposure);
    gl.uniform1f(u.uGrain, P.grain); gl.uniform1f(u.uTime, time); gl.uniform2f(u.uRes, RW, RH);
  });
  if (snapRequested) { snapRequested = false; snapshot(); }
}
function snapshot() {
  const c = document.createElement('canvas'); c.width = RW; c.height = RH;
  const g = c.getContext('2d'); g.drawImage(glc, 0, 0);
  c.toBlob(b => {
    const box = $('#photo'), img = box.querySelector('img');
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(b); box.hidden = false;
  });
}
function clearAll() {
  for (const t of [stA, stB]) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  particles.length = 0; tracks.length = 0; pinned = null; hover = null; showInspector();
}

// ---------------------------------------------------------------- audio layer
const audio = {
  ctx: null, out: null, noise: null, last: 0,
  init() {
    if (this.ctx) return; const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    this.ctx = new A(); this.out = this.ctx.createGain(); this.out.gain.value = 0.35; this.out.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.25, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, 3);
    this.noise = b;
  },
  ok() { if (!P.audio || !this.ctx) return false; const n = this.ctx.currentTime; if (n - this.last < 0.03) return false; this.last = n; return true; },
  ping(kind) {
    if (!this.ok()) return; const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    const base = { pair: 1320, 'pi+': 660, 'pi-': 620, 'mu+': 990, 'mu-': 940, 'K+': 520, 'K-': 495, K0: 740, L0: 830, 'e+': 1760 }[kind] || 880;
    o.type = 'sine'; o.frequency.setValueAtTime(base * (1 + gauss() * .01), t); o.frequency.exponentialRampToValueAtTime(base * .5, t + .25);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + .005); g.gain.exponentialRampToValueAtTime(0.0001, t + .35);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + .4);
  },
  star(n) {
    if (!this.ok()) return; const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = 300 + n * 120; f.Q.value = 2; g.gain.value = 0.5;
    s.connect(f).connect(g).connect(this.out); s.start(t);
    for (let i = 0; i < Math.min(n, 5); i++) setTimeout(() => this.ping('star'), i * 35);
  },
  thump() {
    if (!P.audio || !this.ctx) return; const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(38, t + .3);
    g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + .45);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + .5);
  },
};

// ---------------------------------------------------------------- tools / pointer interaction
const TOOLS = [
  { id: 'shoot', label: 'fire', key: '1', icon: '<path d="M4 20c6-2 10-7 12-14" /><path d="M13 5l3 1 1-3"/><circle cx="4" cy="20" r="1.6" fill="currentColor"/>' },
  { id: 'field', label: 'field', key: '2', icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2" fill="currentColor"/>' },
  { id: 'target', label: 'target', key: '3', icon: '<circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>' },
  { id: 'source', label: 'source', key: '4', icon: '<circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 4a8 8 0 0 1 7 4M5 16a8 8 0 0 0 7 4M19 16l-2-1M5 8l2 1"/>' },
  { id: 'beam', label: 'beam', key: '5', icon: '<rect x="2" y="9" width="8" height="6" rx="1"/><path d="M10 12h12M18 9l3 3-3 3"/>' },
  { id: 'inspect', label: 'inspect', key: '6', icon: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l6 6"/>' },
];
let tool = 'shoot';
const pointers = new Map();
let hover = null, pinned = null, mouse = { x: -1, y: -1 };

function setTool(id) {
  tool = id;
  document.querySelectorAll('#tools button').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  buildToolOpts();
}
function hitEmitter(x, y) {
  for (const e of emitters) {
    const kx = e.x + Math.cos(e.a) * 46, ky = e.y + Math.sin(e.a) * 46;
    if (Math.hypot(x - kx, y - ky) < 13) return { e, part: 'aim' };
    if (Math.hypot(x - e.x, y - e.y) < 16) return { e, part: 'body' };
  }
  return null;
}
const hitList = (list, x, y, r = 16) => list.find(o => Math.hypot(x - o.x, y - o.y) < r);
const momentumFromDrag = d => clamp(15 * Math.exp(d / 70), 15, 8000);

uic.addEventListener('contextmenu', e => e.preventDefault());
uic.addEventListener('pointerdown', ev => {
  if (P.audio) { audio.init(); audio.ctx && audio.ctx.resume(); }
  uic.setPointerCapture(ev.pointerId);
  const x = ev.clientX, y = ev.clientY;
  const st = { x0: x, y0: y, x, y, t0: performance.now(), mode: tool, neg: ev.button === 2 || ev.altKey, shift: ev.shiftKey };
  const he = hitEmitter(x, y);
  if (he) { st.mode = 'emitter-' + he.part; st.obj = he.e; }
  else if (tool === 'target' || tool === 'source') {
    const list = tool === 'target' ? targets : sources, o = hitList(list, x, y);
    if (o) { st.mode = 'move'; st.obj = o; st.list = list; }
    else if (inWindow(x, y)) { const n = tool === 'target' ? { x, y, r: 20 } : { x, y, acc: 0, type: P.sourceType }; list.push(n); st.mode = 'placed'; st.obj = n; }
  } else if (tool === 'beam') {
    if (inWindow(x, y)) {
      const ang = Math.atan2(y - H / 2, x - W / 2);
      const e = addEmitter(ang, 'mix', 900, 1.4); e.x = x; e.y = y; e.rx = x / W; e.ry = y / H; st.mode = 'emitter-aim'; st.obj = e;
    }
  } else if (tool === 'inspect') {
    pin(hover);
  }
  pointers.set(ev.pointerId, st);
});
uic.addEventListener('pointermove', ev => {
  const x = ev.clientX, y = ev.clientY; mouse.x = x; mouse.y = y;
  const st = pointers.get(ev.pointerId);
  if (!st) { if (tool === 'inspect') updateHover(x, y); updateCursor(x, y); return; }
  const dx = x - st.x, dy = y - st.y; st.x = x; st.y = y;
  if (st.mode === 'emitter-body' || st.mode === 'move' || st.mode === 'placed') {
    if (Math.hypot(x - st.x0, y - st.y0) > 4 && st.mode === 'placed') st.mode = 'move';
    if (inWindow(x, y)) { st.obj.x = x; st.obj.y = y; if (st.obj.rx !== undefined) { st.obj.rx = x / W; st.obj.ry = y / H; } }
  } else if (st.mode === 'emitter-aim') {
    st.obj.a = Math.atan2(y - st.obj.y, x - st.obj.x);
  } else if (st.mode === 'field') {
    const amt = (st.neg ? -1 : 1) * P.brush * 0.004 * Math.hypot(dx, dy) + (st.neg ? -1 : 1) * P.brush * 0.01;
    field.paint(x, y, amt, P.brushR);
  }
});
function endPointer(ev) {
  const st = pointers.get(ev.pointerId); if (!st) return;
  pointers.delete(ev.pointerId);
  const d = Math.hypot(st.x - st.x0, st.y - st.y0);
  if (st.mode === 'shoot') {
    if (d < 8) { if (inWindow(st.x0, st.y0)) spark(st.x0, st.y0); }
    else if (inWindow(st.x0, st.y0)) {
      const p = momentumFromDrag(d), n = st.shift ? 8 : P.burst;
      for (let i = 0; i < n; i++) {
        const sp = P.shootSpecies === 'mix' ? pick(BEAM_MIX) : P.shootSpecies, a = Math.atan2(st.y - st.y0, st.x - st.x0) + (n > 1 ? gauss() * .03 : 0);
        const o = spawn(sp, st.x0, st.y0, Math.cos(a), Math.sin(a), p * (n > 1 ? 1 + gauss() * .05 : 1));
        if (o && n === 1) logEvent(`fired <em>${SP[sp].sym}</em> ${fmtP(p)}`);
      }
    }
  } else if (st.mode === 'move' && !inWindow(st.x, st.y)) {
    st.list.splice(st.list.indexOf(st.obj), 1);
  } else if (st.mode === 'emitter-body' && d < 4 && performance.now() - st.t0 < 300) {
    fireEmitter(st.obj, 6);
  } else if ((tool === 'target' || tool === 'source') && st.mode === 'move' && d < 4) {
    st.list.splice(st.list.indexOf(st.obj), 1);
  }
  if (st.mode.startsWith('emitter')) buildEmitterUI();
}
uic.addEventListener('pointerup', endPointer);
uic.addEventListener('pointercancel', endPointer);
uic.addEventListener('pointerleave', () => { if (!pointers.size) { hover = null; $('#tip').classList.remove('on'); } });
uic.addEventListener('dblclick', ev => {
  const he = hitEmitter(ev.clientX, ev.clientY); if (!he) return;
  const i = SHOOTABLE.indexOf(he.e.sp); he.e.sp = SHOOTABLE[(i + 1) % SHOOTABLE.length]; buildEmitterUI();
});
uic.addEventListener('wheel', ev => {
  const he = hitEmitter(ev.clientX, ev.clientY);
  if (he) { ev.preventDefault(); he.e.p = clamp(he.e.p * Math.exp(-ev.deltaY * 0.0015), 20, 8000); buildEmitterUI(); return; }
  if (tool === 'field') { ev.preventDefault(); P.brushR = clamp(P.brushR * Math.exp(-ev.deltaY * 0.001), 30, 300); buildToolOpts(); }
}, { passive: false });
function updateCursor(x, y) {
  const he = hitEmitter(x, y);
  uic.style.cursor = he ? (he.part === 'aim' ? 'grab' : 'move') : (tool === 'target' && hitList(targets, x, y)) || (tool === 'source' && hitList(sources, x, y)) ? 'move' : tool === 'inspect' ? (hover ? 'pointer' : 'default') : 'crosshair';
}

// nearest track under cursor
function updateHover(x, y) {
  let best = null, bd = 12 * 12;
  for (const t of tracks) {
    if (SP[t.sp].q === 0 && !P.recon) continue;
    const p = t.pts;
    for (let i = 0; i < p.length - 2; i += 2) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
      const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
      const k = clamp(((x - ax) * vx + (y - ay) * vy) / l2, 0, 1);
      const ex = ax + vx * k - x, ey = ay + vy * k - y, d2 = ex * ex + ey * ey;
      if (d2 < bd) { bd = d2; best = t; }
    }
  }
  hover = best;
  const tip = $('#tip');
  if (best) {
    const s = SP[best.sp];
    tip.innerHTML = `<b>${s.sym}</b> ${s.name}<br>p₀ ${fmtP(best.p0)} · q ${s.q > 0 ? '+' : ''}${s.q}<br>${best.alive ? 'in flight' : best.end}`;
    tip.style.left = Math.min(x + 16, W - 190) + 'px'; tip.style.top = (y + 14) + 'px'; tip.classList.add('on');
  } else tip.classList.remove('on');
}
function pin(t) { pinned = t; showInspector(); }
function showInspector() {
  const el = $('#inspector');
  if (!pinned) { el.classList.remove('on'); return; }
  const t = pinned, s = SP[t.sp];
  const B = field.at(t.pts[0], t.pts[1]);
  const radius = s.q ? (t.p0 / 1000) / (0.3 * Math.abs(s.q) * Math.max(Math.abs(B), 0.01)) : Infinity;
  const kids = t.kids.map(k => `<div><a data-id="${k.id}">${SP[k.sp].sym}</a> ${fmtP(k.p0)}${k.kids.length ? ` <span style="opacity:.5">+${k.kids.length}</span>` : ''}</div>`).join('');
  el.innerHTML = `<h3><span>${s.sym} <small style="font:11px var(--mono);color:var(--muted)">${s.name} #${t.id}</small></span><button id="unpin" aria-label="Close">×</button></h3>
    <dl><dt>mass</dt><dd>${fmtE(s.m)}/c²</dd><dt>charge</dt><dd>${s.q > 0 ? '+' : ''}${s.q} e</dd>
    <dt>p₀</dt><dd>${fmtP(t.p0)}</dd><dt>r₀ @ ${B.toFixed(2)} T</dt><dd>${isFinite(radius) ? radius.toFixed(2) + ' m' : '∞'}</dd>
    <dt>path</dt><dd>${(t.len / S * 100).toFixed(1)} cm</dd><dt>fate</dt><dd>${t.alive ? 'in flight' : t.end}</dd></dl>
    <div class="tree">${t.parent ? `parent: <a data-id="${t.parent.id}">${SP[t.parent.sp].sym}</a><br>` : 'primary<br>'}${kids ? 'daughters:' + kids : ''}</div>`;
  el.classList.add('on');
  $('#unpin').onclick = () => pin(null);
  el.querySelectorAll('a[data-id]').forEach(a => a.onclick = () => { const id = +a.dataset.id; const f = tracks.find(x => x.id === id); if (f) pin(f); });
}

// predicted trajectory for an aimed shot (no randomness, energy loss included)
function predict(x, y, a, p, sp) {
  const s = SP[sp], pts = [x, y]; if (!s) return pts;
  let dx = Math.cos(a), dy = Math.sin(a), E = Math.sqrt(p * p + s.m * s.m), beta = s.m ? p / E : 1;
  for (let i = 0; i < 900; i++) {
    const ds = 3;
    if (s.q) {
      const B = field.at(x, y), dth = -s.q * B * ds * CURV / (p * S);
      if (Math.abs(dth) > .8) break;
      const c = Math.cos(dth), sn = Math.sin(dth), nx = dx * c - dy * sn; dy = dy * c + dx * sn; dx = nx;
      E -= K_LOSS * P.density * s.q * s.q * Math.min(1 / (beta * beta), 30) * ds / S;
      if (E - s.m <= 0.6) break;
      p = Math.sqrt(E * E - s.m * s.m); beta = p / E;
    }
    x += dx * ds; y += dy * ds; pts.push(x, y);
    if (!inWindow(x, y)) break;
  }
  return pts;
}

// ---------------------------------------------------------------- overlay drawing
const C = { accent: '#7fe9ff', warm: '#ffb45c', neg: '#ff6f8c', text: '#d8eef2', muted: '#7d9aa1' };
function poly(pts, from = 0) { ctx.beginPath(); ctx.moveTo(pts[from], pts[from + 1]); for (let i = from + 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); }
const trackColor = t => { const s = SP[t.sp]; return s.q === 0 ? 'rgba(255,255,255,.55)' : `hsl(${(s.hue || 0) * 360} 85% 65%)`; };
function drawOverlay(time) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const film = P.style === 1;
  // field map
  if (P.showField || tool === 'field') {
    const c = field.cell * 2;
    for (let y = c / 2; y < H; y += c) for (let x = c / 2; x < W; x += c) {
      if (!inWindow(x, y)) continue;
      const b = field.at(x, y), r = clamp(Math.abs(b) * 4, 1, 10), al = clamp(0.12 + Math.abs(b) * 0.12, 0, .5);
      ctx.strokeStyle = ctx.fillStyle = b >= 0 ? `rgba(255,180,92,${al})` : `rgba(127,233,255,${al})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.stroke();
      if (b >= 0) { ctx.beginPath(); ctx.arc(x, y, 1.3, 0, 6.283); ctx.fill(); }
      else { const k = r * .6; ctx.beginPath(); ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k); ctx.stroke(); }
    }
    if (tool === 'field' && mouse.x >= 0) {
      ctx.strokeStyle = 'rgba(216,238,242,.35)'; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.arc(mouse.x, mouse.y, P.brushR, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  // reconstruction layer: every track as a fitted line, neutrals dashed, vertices marked
  if (P.recon) {
    ctx.lineWidth = 1;
    for (const t of tracks) {
      if (t.pts.length < 4) continue;
      const neutral = SP[t.sp].q === 0;
      ctx.strokeStyle = trackColor(t); ctx.globalAlpha = neutral ? .7 : .55;
      ctx.setLineDash(neutral ? [3, 4] : []);
      poly(t.pts); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = C.warm;
    for (const t of tracks) if (t.kids.length && !t.alive) { const n = t.pts.length; ctx.beginPath(); ctx.arc(t.pts[n - 2], t.pts[n - 1], 2.5, 0, 6.283); ctx.fill(); }
    // neutrals still in flight need their head drawn
    for (const o of particles) if (o.s.q === 0) { ctx.strokeStyle = trackColor(o.track); ctx.setLineDash([3, 4]); ctx.beginPath(); const p = o.track.pts; ctx.moveTo(p[p.length - 2], p[p.length - 1]); ctx.lineTo(o.x, o.y); ctx.stroke(); ctx.setLineDash([]); }
  }
  // hover & pinned highlight (with family tree for pinned)
  const hl = (t, w, al) => { if (!t || t.pts.length < 2) return; ctx.lineWidth = w; ctx.strokeStyle = trackColor(t); ctx.globalAlpha = al; ctx.setLineDash(SP[t.sp].q === 0 ? [3, 4] : []); poly(t.pts); const live = particles.find(o => o.track === t); if (live) ctx.lineTo(live.x, live.y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; };
  if (pinned) {
    const walk = (t, d) => { hl(t, d ? 1.2 : 2.4, d ? .55 : .95); if (d < 4) t.kids.forEach(k => walk(k, d + 1)); };
    if (pinned.parent) hl(pinned.parent, 1, .35);
    walk(pinned, 0);
    ctx.fillStyle = C.text; ctx.beginPath(); ctx.arc(pinned.pts[0], pinned.pts[1], 3, 0, 6.283); ctx.fill();
  }
  if (hover && hover !== pinned) hl(hover, 2, .8);
  // targets
  for (const t of targets) {
    ctx.strokeStyle = film ? 'rgba(40,30,20,.6)' : 'rgba(255,180,92,.75)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, 6.283); ctx.stroke();
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r * .35 + Math.sin(time * 3) * 1.5, 0, 6.283); ctx.stroke();
    ctx.beginPath(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; ctx.moveTo(t.x + Math.cos(a) * (t.r + 3), t.y + Math.sin(a) * (t.r + 3)); ctx.lineTo(t.x + Math.cos(a) * (t.r + 9), t.y + Math.sin(a) * (t.r + 9)); } ctx.stroke();
  }
  // sources
  for (const s of sources) {
    ctx.fillStyle = film ? 'rgba(40,30,20,.7)' : 'rgba(255,111,140,.85)';
    ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, 6.283); ctx.fill();
    for (let k = 0; k < 3; k++) { const a = k * 2.094 + time * .6; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.arc(s.x, s.y, 11, a, a + 0.75); ctx.closePath(); ctx.globalAlpha = .45; ctx.fill(); ctx.globalAlpha = 1; }
  }
  // emitters
  ctx.font = '10px "JetBrains Mono", monospace';
  for (const e of emitters) {
    const ca = Math.cos(e.a), sa = Math.sin(e.a);
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.a);
    ctx.fillStyle = film ? 'rgba(30,25,20,.8)' : 'rgba(10,24,28,.85)'; ctx.strokeStyle = film ? 'rgba(30,25,20,.9)' : C.accent; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-22, -8, 30, 16, 3) : ctx.rect(-22, -8, 30, 16); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, -4); ctx.lineTo(13, 0); ctx.lineTo(8, 4); ctx.stroke();
    ctx.setLineDash([2, 4]); ctx.globalAlpha = .5; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(40, 0); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.restore();
    const kx = e.x + ca * 46, ky = e.y + sa * 46;
    ctx.beginPath(); ctx.arc(kx, ky, 5, 0, 6.283); ctx.strokeStyle = film ? 'rgba(30,25,20,.9)' : C.accent; ctx.stroke();
    ctx.fillStyle = film ? '#2a2018' : C.text; ctx.textAlign = 'center';
    ctx.fillText(`${symOf(e.sp)} ${fmtP(e.p)}`, clamp(e.x - ca * 4, 48, W - 48), clamp(e.y - sa * 4 + (sa > 0.3 ? -16 : 22), 12, H - 6));
  }
  // aim previews for every active shooting pointer (multi-touch aware)
  for (const st of pointers.values()) {
    if (st.mode !== 'shoot') continue;
    const d = Math.hypot(st.x - st.x0, st.y - st.y0); if (d < 8) continue;
    const p = momentumFromDrag(d), a = Math.atan2(st.y - st.y0, st.x - st.x0);
    const sp = P.shootSpecies === 'mix' ? 'pi-' : P.shootSpecies;
    const pts = predict(st.x0, st.y0, a, p, sp);
    ctx.strokeStyle = film ? 'rgba(30,25,20,.8)' : C.warm; ctx.lineWidth = 1.4; ctx.setLineDash([5, 5]); ctx.lineDashOffset = -time * 30;
    poly(pts); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = .35; ctx.beginPath(); ctx.moveTo(st.x0, st.y0); ctx.lineTo(st.x, st.y); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(st.x0, st.y0, 4, 0, 6.283); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
    const B = field.at(st.x0, st.y0), r = SP[sp].q ? (p / 1000) / (0.3 * Math.abs(SP[sp].q) * Math.max(Math.abs(B), .01)) : Infinity;
    ctx.textAlign = 'left'; ctx.fillStyle = film ? '#2a2018' : C.text;
    ctx.fillText(`${symOf(P.shootSpecies)}  ${fmtP(p)}  r=${isFinite(r) ? r.toFixed(2) + 'm' : '∞'}`, st.x + 12, st.y - 10);
  }
  // pulsed cycle indicator
  if (P.pulsed) {
    const x = W - 34, y = H - 34;
    ctx.strokeStyle = 'rgba(127,233,255,.25)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 14, 0, 6.283); ctx.stroke();
    ctx.strokeStyle = sens > 0 ? C.warm : C.accent; ctx.beginPath(); ctx.arc(x, y, 14, -Math.PI / 2, -Math.PI / 2 + cyclePhase * 6.283); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.fillText(sens > 0 ? 'EXPANSION' : wipe ? 'RECOMPRESS' : 'GROWTH', x - 22, y + 3);
  }
}

// ---------------------------------------------------------------- UI construction
function slider(parent, key, label, min, max, step, fmt = v => v.toFixed(2), onChange) {
  const row = document.createElement('label'); row.className = 'row';
  row.innerHTML = `<span>${label}</span><output>${fmt(P[key])}</output><input type="range" min="${min}" max="${max}" step="${step}" value="${P[key]}">`;
  const inp = row.querySelector('input'), out = row.querySelector('output');
  inp.oninput = () => { P[key] = +inp.value; out.textContent = fmt(P[key]); onChange && onChange(); };
  parent.appendChild(row); return inp;
}
function toggle(parent, key, label, onChange) {
  const row = document.createElement('label'); row.className = 'chk';
  row.innerHTML = `<span>${label}</span><span class="switch"><input type="checkbox" ${P[key] ? 'checked' : ''}><i></i></span>`;
  const inp = row.querySelector('input'); inp.onchange = () => { P[key] = inp.checked; onChange && onChange(); };
  row.sync = () => inp.checked = P[key];
  parent.appendChild(row); return row;
}
function heading(parent, text, btn) {
  const h = document.createElement('h2'); h.textContent = text;
  if (btn) { const b = document.createElement('button'); b.textContent = btn[0]; b.onclick = btn[1]; h.appendChild(b); }
  parent.appendChild(h);
}
const panel = $('#panel');
let toggles = {}, styleSeg;
function buildPanel() {
  panel.innerHTML = '';
  heading(panel, 'Chamber', ['clear', clearAll]);
  slider(panel, 'B', 'Magnetic field B', -3, 3, 0.01, v => v.toFixed(2) + ' T', () => $('#bread').textContent = P.B.toFixed(2) + ' T');
  slider(panel, 'density', 'Liquid density / dE/dx', 0.2, 3, 0.01, v => '×' + v.toFixed(2));
  slider(panel, 'speed', 'Time scale', 0.05, 3, 0.01, v => '×' + v.toFixed(2));
  heading(panel, 'Bubbles');
  slider(panel, 'bubbles', 'Nucleation rate', 0.1, 3, 0.01, v => '×' + v.toFixed(2));
  slider(panel, 'size', 'Bubble size', 0.4, 3, 0.01, v => '×' + v.toFixed(2));
  slider(panel, 'growth', 'Growth', 0.2, 3, 0.01, v => '×' + v.toFixed(2));
  slider(panel, 'spread', 'Coalescence', 0, 1.05, 0.01);
  slider(panel, 'persistence', 'Persistence', 0, 1, 0.01);
  slider(panel, 'drift', 'Convection', 0, 2, 0.01, v => v.toFixed(2) + ' px/f');
  heading(panel, 'Beam line', ['+ add', () => addEmitter(rand() * 6.283)]);
  const ew = document.createElement('div'); ew.id = 'emitters'; panel.appendChild(ew);
  heading(panel, 'Layers');
  toggles.cosmics = toggle(panel, 'cosmics', 'Cosmic-ray muons');
  toggles.pulsed = toggle(panel, 'pulsed', 'Pulsed expansion cycle');
  toggles.recon = toggle(panel, 'recon', 'Reconstruction overlay  R');
  toggles.showField = toggle(panel, 'showField', 'Field map overlay');
  toggles.audio = toggle(panel, 'audio', 'Sonify events', () => { if (P.audio) { audio.init(); audio.ctx && audio.ctx.resume(); } });
  toggles.paused = toggle(panel, 'paused', 'Pause  ␣');
  heading(panel, 'Optics');
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = `<span>Look</span><output>S</output><div class="seg">${STYLES.map((s, i) => `<button data-i="${i}">${s}</button>`).join('')}</div>`;
  styleSeg = row; row.querySelectorAll('button').forEach(b => b.onclick = () => setStyle(+b.dataset.i));
  panel.appendChild(row); setStyle(P.style);
  slider(panel, 'exposure', 'Exposure', 0.3, 4, 0.01);
  slider(panel, 'bloom', 'Bloom', 0, 3, 0.01);
  slider(panel, 'grain', 'Film grain', 0, 0.25, 0.001, v => v.toFixed(3));
  slider(panel, 'caustics', 'Liquid caustics', 0, 3, 0.01);
  heading(panel, 'Keys');
  const k = document.createElement('p'); k.className = 'keys';
  k.innerHTML = `<b>1–6</b> layers · <b>␣</b> pause · <b>C</b> clear · <b>S</b> look<br><b>R</b> reconstruction · <b>F</b> field map · <b>X</b> pulse<br><b>B</b> burst all beams · <b>P</b> photo · <b>H</b> hide UI<br><b>drag</b> emitter body / knob · <b>wheel</b> emitter momentum<br><b>dbl-click</b> emitter species · <b>tap</b> emitter fires`;
  panel.appendChild(k);
  const b = document.createElement('div'); b.className = 'btnrow'; b.style.marginTop = '10px';
  b.innerHTML = `<button class="btn" id="bPhoto">photograph</button><button class="btn" id="bBurst">burst</button><button class="btn" id="bReset">reset scene</button>`;
  panel.appendChild(b);
  $('#bPhoto').onclick = () => snapRequested = true;
  $('#bBurst').onclick = () => emitters.forEach(e => fireEmitter(e, 8));
  $('#bReset').onclick = () => defaultScene(true);
  buildEmitterUI();
}
function setStyle(i) { P.style = i; styleSeg && styleSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.i === i)); }
function buildEmitterUI() {
  const ew = $('#emitters'); if (!ew) return; ew.innerHTML = '';
  emitters.forEach((e, idx) => {
    const box = document.createElement('div'); box.className = 'emitter';
    box.innerHTML = `<header><span>BEAM ${idx + 1}</span><button aria-label="Remove beam">×</button></header>
      <label class="row"><span>Species</span><output></output><select>${SHOOTABLE.map(s => `<option value="${s}" ${s === e.sp ? 'selected' : ''}>${symOf(s)}${s === 'mix' ? ' (secondary beam)' : ''}</option>`).join('')}</select></label>
      <label class="row"><span>Momentum</span><output>${fmtP(e.p)}</output><input type="range" min="2.7" max="9" step="0.01" value="${Math.log(e.p)}"></label>
      <label class="row"><span>Rate</span><output>${e.rate.toFixed(1)}/s</output><input type="range" min="0" max="12" step="0.1" value="${e.rate}"></label>`;
    box.querySelector('header button').onclick = () => { emitters.splice(emitters.indexOf(e), 1); buildEmitterUI(); };
    box.querySelector('select').onchange = ev => e.sp = ev.target.value;
    const [mp, rt] = box.querySelectorAll('input'), [, mo, ro] = box.querySelectorAll('output');
    mp.oninput = () => { e.p = Math.exp(+mp.value); mo.textContent = fmtP(e.p); };
    rt.oninput = () => { e.rate = +rt.value; ro.textContent = e.rate.toFixed(1) + '/s'; };
    ew.appendChild(box);
  });
}
function buildToolOpts() {
  const o = $('#toolopts'); o.innerHTML = '';
  const add = html => { const s = document.createElement('label'); s.innerHTML = html; o.appendChild(s); return s; };
  if (tool === 'shoot') {
    const s = add(`particle <select>${SHOOTABLE.map(k => `<option value="${k}" ${k === P.shootSpecies ? 'selected' : ''}>${symOf(k)}</option>`).join('')}</select>`);
    s.querySelector('select').onchange = e => P.shootSpecies = e.target.value;
    const b = add(`burst <input type="range" min="1" max="12" step="1" value="${P.burst}"> <span>${P.burst}</span>`);
    b.querySelector('input').oninput = e => { P.burst = +e.target.value; b.querySelector('span').textContent = P.burst; };
    add(`<span class="desc">drag to aim · length = momentum · tap = spark</span>`);
  } else if (tool === 'field') {
    const a = add(`strength <input type="range" min="0.1" max="3" step="0.01" value="${P.brush}">`); a.querySelector('input').oninput = e => P.brush = +e.target.value;
    const r = add(`radius <input type="range" min="30" max="300" step="1" value="${P.brushR}">`); r.querySelector('input').oninput = e => P.brushR = +e.target.value;
    const c = document.createElement('button'); c.className = 'btn'; c.textContent = 'flatten'; c.onclick = () => field.clear(); o.appendChild(c);
    add(`<span class="desc">paint ⊙ · right-drag / alt ⊗</span>`);
  } else if (tool === 'target') {
    const a = add(`interaction <input type="range" min="0" max="1" step="0.01" value="${P.targetProb}">`); a.querySelector('input').oninput = e => P.targetProb = +e.target.value;
    add(`<span class="desc">click to place nucleus · drag to move · click again to remove</span>`);
  } else if (tool === 'source') {
    const s = add(`isotope <select><option value="mixed">α + β mixed</option><option value="beta">β emitter</option><option value="alpha">α emitter</option></select>`);
    s.querySelector('select').value = P.sourceType; s.querySelector('select').onchange = e => P.sourceType = e.target.value;
    const r = add(`activity <input type="range" min="0.5" max="30" step="0.5" value="${P.sourceRate}">`); r.querySelector('input').oninput = e => P.sourceRate = +e.target.value;
  } else if (tool === 'beam') {
    add(`<span class="desc">click inside to place a beam port, drag to aim · panel ▸ Beam line for species / rate</span>`);
  } else if (tool === 'inspect') {
    add(`<span class="desc">hover a track · click to pin and walk its decay tree</span>`);
    const t = document.createElement('label'); t.innerHTML = `show neutrals <span class="switch"><input type="checkbox" ${P.recon ? 'checked' : ''}><i></i></span>`;
    t.querySelector('input').onchange = e => { P.recon = e.target.checked; toggles.recon.sync(); }; o.appendChild(t);
  }
}
function buildTools() {
  $('#tools').innerHTML = TOOLS.map(t => `<button data-id="${t.id}" title="${t.label} (${t.key})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg><span class="lbl">${t.label}</span></button>`).join('');
  document.querySelectorAll('#tools button').forEach(b => b.onclick = () => setTool(b.dataset.id));
}
$('#photo').onclick = () => $('#photo').hidden = true;
$('#paneltoggle').onclick = () => panel.classList.toggle('closed');
if (innerWidth < 720) panel.classList.add('closed');

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  const t = TOOLS.find(t => t.key === k); if (t) { setTool(t.id); return; }
  if (k === ' ') { e.preventDefault(); P.paused = !P.paused; toggles.paused.sync(); }
  else if (k === 'c') clearAll();
  else if (k === 's') setStyle((P.style + 1) % STYLES.length);
  else if (k === 'r') { P.recon = !P.recon; toggles.recon.sync(); if (tool === 'inspect') buildToolOpts(); }
  else if (k === 'f') { P.showField = !P.showField; toggles.showField.sync(); }
  else if (k === 'x') { P.pulsed = !P.pulsed; toggles.pulsed.sync(); }
  else if (k === 'h') document.body.classList.toggle('hideui');
  else if (k === 'p') snapRequested = true;
  else if (k === 'b') emitters.forEach(em => fireEmitter(em, 8));
  else if (k === 'escape') pin(null);
});

// ---------------------------------------------------------------- scene
function defaultScene(reset) {
  if (reset) { clearAll(); emitters.length = 0; targets.length = 0; sources.length = 0; field.clear(); }
  addEmitter(Math.PI, 'mix', 750, 1.3);
  addEmitter(Math.PI * 1.16, 'K-', 420, 0.35);
  targets.push({ x: W * 0.44, y: H * 0.48, r: 20 });
  sources.push({ x: W * 0.74, y: H * 0.7, acc: 0, type: 'mixed' });
}

let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const ow = W, oh = H; resize();
    const sx = W / ow, sy = H / oh;
    for (const o of [...targets, ...sources]) { o.x *= sx; o.y *= sy; }
    for (const e of emitters) { e.x = e.rx * W; e.y = e.ry * H; }
    particles.length = 0; tracks.length = 0; pinned = null; showInspector();
  }, 150);
});

// ---------------------------------------------------------------- main loop
resize();
buildTools(); buildPanel(); setTool('shoot'); defaultScene(false);
setTimeout(() => $('#hint').classList.add('gone'), 9000);

let last = performance.now(), fpsAcc = 0, fpsN = 0, statT = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  const time = now / 1000;
  if (!P.paused) simulate(dt);
  // held field brush keeps painting while still
  for (const st of pointers.values()) if (st.mode === 'field') field.paint(st.x, st.y, (st.neg ? -1 : 1) * P.brush * dt * 0.6, P.brushR);
  render(time);
  drawOverlay(time);
  fpsAcc += dt; fpsN++; statT += dt;
  if (statT > 0.5) {
    bubRate = bubblesThisSec / statT; bubblesThisSec = 0;
    $('#sLive').textContent = particles.length; $('#sTracks').textContent = tracks.length;
    $('#sBub').textContent = bubRate > 9999 ? (bubRate / 1000).toFixed(1) + 'k' : Math.round(bubRate);
    $('#sFps').textContent = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; statT = 0;
    if (pinned) showInspector();
    if (tool === 'inspect' && mouse.x >= 0 && !pointers.size) updateHover(mouse.x, mouse.y);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__chamber = { P, particles, tracks, emitters, spawn, setTool, setStyle, fireEmitter };
})();
