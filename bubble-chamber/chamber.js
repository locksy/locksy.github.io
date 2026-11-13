/* Bubble Chamber — cinematic WebGL2 particle-track visualizer.
 *
 * Per frame:
 *   CPU physics   -> bubble nucleation sites (x, y, size, intensity, hue, depth) + ionisation glow sprites
 *   GPU deposit   -> additive sprites into a seed buffer; glow into a decaying emissive buffer
 *   GPU evolve    -> ping-pong state: nucleation -> growth -> coalescence -> convection -> fade
 *   GPU shade     -> MRT: (a) lit refracting bubbles, premultiplied   (b) liquid volume, light shafts, caustics, motes + CoC
 *   GPU optics    -> scatter-as-gather depth of field with bokeh over a mipmapped bubble layer, composited on the volume
 *   GPU bloom     -> 3-level bloom, anamorphic streak
 *   GPU film      -> barrel distortion, chromatic aberration, halation, lens dirt, ACES, grade, grain, vignette, letterbox
 *   2D overlay    -> lamps, emitters, targets, sources, field map, aim prediction, reconstruction, inspection
 */
(() => {
'use strict';

// ---------------------------------------------------------------- params
const P = {
  B: 1.2, density: 1.0, bubbles: 1.0, size: 1.0, growth: 1.0, persistence: 0.55, spread: 0.55, drift: 0.12, speed: 1.0,
  grade: 'cherenkov', exposure: 1.0, bloom: 1.0, streak: 0.7, dirt: 0.8, grain: 1.0, distort: 0.6, letterbox: false,
  aperture: 0.55, focusMode: 'auto', focus: 0.5, glow: 1.0, trail: 0.9, species: 0.0, torch: true, torchHue: 195, chroma: false,
  caustics: 1.0, motes: 1.0,
  cosmics: true, pulsed: false, audio: false, showField: false, recon: false, paused: false,
  yantra: 1.0, rings: 1.0, ringRate: 1.0, waves: 1.0, florets: 144, floretSpacing: 5.5, fibElectrons: true,
  shootSpecies: 'pi-', burst: 1, brush: 0.8, brushR: 90, targetProb: 0.5, sourceType: 'mixed', sourceRate: 4,
};

// film grades: lamp rig [hue°, sat, intensity] + colour pipeline
const GRADES = {
  cherenkov: { name: 'cherenkov', lamps: [[205, .9, 1.7], [30, .85, 1.35], [272, .75, 1.0]], liquid: [.0016, .0042, .0085], fog: [.01, .035, .07], ambient: [.10, .14, .2],
    shadow: [.82, 1.0, 1.18], high: [1.1, 1.0, .88], sat: 1.05, contrast: .35, mono: 0, streakTint: [.35, .6, 1.0], hal: .45, vig: .6, flicker: 0, grainAmt: .045, species: 0 },
  sodium: { name: 'sodium noir', lamps: [[28, .95, 2.0], [6, .9, 1.0], [188, .55, .55]], liquid: [.0055, .0026, .0010], fog: [.06, .025, .01], ambient: [.14, .09, .06],
    shadow: [.78, .98, 1.14], high: [1.18, 1.0, .78], sat: 1.15, contrast: .55, mono: 0, streakTint: [1.0, .55, .22], hal: .9, vig: .75, flicker: .3, grainAmt: .06, species: 0 },
  aurora: { name: 'aurora', lamps: [[148, .9, 1.5], [308, .85, 1.5], [205, .6, .8]], liquid: [.0022, .0012, .0065], fog: [.03, .02, .07], ambient: [.08, .1, .14],
    shadow: [1.04, .9, 1.12], high: [.96, 1.06, 1.0], sat: 1.25, contrast: .3, mono: 0, streakTint: [.7, .45, 1.0], hal: .35, vig: .55, flicker: 0, grainAmt: .04, species: .55 },
  archive: { name: 'archive', lamps: [[40, .1, 1.6], [210, .1, 1.1], [0, 0, .7]], liquid: [.004, .004, .004], fog: [.04, .04, .04], ambient: [.14, .14, .14],
    shadow: [.92, .96, 1.04], high: [1.12, 1.03, .88], sat: 1.0, contrast: .7, mono: 1, streakTint: [.8, .8, .8], hal: .25, vig: .9, flicker: 1, grainAmt: .11, species: 0 },
};
const GRADE_KEYS = Object.keys(GRADES);
const G = JSON.parse(JSON.stringify(GRADES.cherenkov)); // live (lerped) grade

// ---------------------------------------------------------------- species
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
const gauss = () => { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185 * rand()); };
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const pick = list => { let t = 0; for (const [, w] of list) t += w; let r = rand() * t; for (const [k, w] of list) { if ((r -= w) <= 0) return k; } return list[0][0]; };
const $ = s => document.querySelector(s);
const fmtP = p => p >= 1000 ? (p / 1000).toFixed(2) + ' GeV/c' : p.toFixed(p < 10 ? 2 : 0) + ' MeV/c';
const fmtE = e => e >= 1000 ? (e / 1000).toFixed(2) + ' GeV' : e.toFixed(e < 10 ? 2 : 1) + ' MeV';
// hue (deg), sat, value -> linear rgb
function hsvLin(h, s, v) {
  h = ((h % 360) + 360) % 360 / 60;
  const f = k => { const kk = (k + h) % 6; return v * (1 - s * Math.max(0, Math.min(kk, 4 - kk, 1))); };
  return [f(5), f(3), f(1)].map(c => Math.pow(c, 2.2));
}
const cssHue = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;

// ---------------------------------------------------------------- GL setup
const glc = $('#gl'), uic = $('#ui');
const gl = glc.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
if (!gl) { $('#nogl').hidden = false; return; }
const ctx = uic.getContext('2d');
const hasFloat = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
gl.getExtension('OES_texture_float_linear');
const FMT = hasFloat ? { i: gl.RGBA16F, t: gl.HALF_FLOAT } : { i: gl.RGBA8, t: gl.UNSIGNED_BYTE };

function shader(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
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
function makeTex(w, h, mips) {
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, FMT.i, w, h, 0, gl.RGBA, FMT.t, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  return tex;
}
function target(w, h, opts = {}) {
  w = Math.max(1, w | 0); h = Math.max(1, h | 0);
  const tex = makeTex(w, h, opts.mips), tex2 = opts.mrt ? makeTex(w, h) : null;
  const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (tex2) { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tex2, 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]); }
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, tex2, fbo, w, h, mips: !!opts.mips };
}
function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); t.tex2 && gl.deleteTexture(t.tex2); gl.deleteFramebuffer(t.fbo); } }

// ---------------------------------------------------------------- shaders
const COMMON = `#version 300 es
precision highp float;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
`;
const VS_FULL = `#version 300 es
out vec2 vUv;
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUv = p; gl_Position = vec4(p*2.-1., 0., 1.); }`;

// bubble nucleation sprites: x y size intensity hue depth
const VS_DEPOSIT = `#version 300 es
layout(location=0) in vec2 aPos; layout(location=1) in vec4 aData;
uniform vec2 uCss;
out vec3 vD;
void main(){ vec2 c = aPos/uCss*2.-1.; c.y = -c.y; gl_Position = vec4(c, 0., 1.); gl_PointSize = aData.x; vD = aData.yzw; }`;
const FS_DEPOSIT = `#version 300 es
precision highp float;
in vec3 vD; out vec4 o;
void main(){ vec2 d = gl_PointCoord*2.-1.; float r2 = dot(d,d); if(r2>1.) discard; float a = 1.-r2; a*=a*vD.x; o = vec4(a, a*vD.y, a*vD.z, 0.); }`;

// emissive ionisation glow sprites: x y size r g b
const VS_GLOW = `#version 300 es
layout(location=0) in vec2 aPos; layout(location=1) in vec4 aData;
uniform vec2 uCss;
out vec3 vC;
void main(){ vec2 c = aPos/uCss*2.-1.; c.y = -c.y; gl_Position = vec4(c, 0., 1.); gl_PointSize = aData.x; vC = aData.yzw; }`;
const FS_GLOW = `#version 300 es
precision highp float;
in vec3 vC; out vec4 o;
void main(){ vec2 d = gl_PointCoord*2.-1.; float r2 = dot(d,d); if(r2>1.) discard; float a = exp(-r2*4.)-.018; o = vec4(vC*max(a,0.), 0.); }`;
const FS_FADE = `#version 300 es
precision highp float; out vec4 o; uniform float uK; void main(){ o = vec4(0., 0., 0., uK); }`;

const FS_EVOLVE = COMMON + `
in vec2 vUv; out vec4 o;
uniform sampler2D uPrev, uSeed; uniform vec2 uTexel; uniform float uAspect, uGrowth, uFade, uSpread, uDrift, uTime, uWipe;
void main(){
  vec2 uv = vUv;
  if(uDrift > 0.){
    vec2 q = uv*vec2(uAspect,1.)*2.2 + vec2(0., uTime*.02); float e = .02;
    float nx = noise(q+vec2(0.,e)) - noise(q-vec2(0.,e));
    float ny = noise(q+vec2(e,0.)) - noise(q-vec2(e,0.));
    uv -= (vec2(nx, -ny)/(2.*e)*.6 + vec2(0., -.25))*uDrift*uTexel;
  }
  vec4 c = texture(uPrev, uv);
  vec4 a = texture(uPrev, uv+vec2(uTexel.x,0.)), b = texture(uPrev, uv-vec2(uTexel.x,0.));
  vec4 d = texture(uPrev, uv+vec2(0.,uTexel.y)), e2 = texture(uPrev, uv-vec2(0.,uTexel.y));
  float R = c.r, hue = c.g, pend = c.b, dep = c.a;
  float grown = max(R, (a.r+b.r+d.r+e2.r)*.25*uSpread);
  if(grown > R + 1e-4){ float w = max(a.r+b.r+d.r+e2.r,1e-4);
    hue = (a.g*a.r+b.g*b.r+d.g*d.r+e2.g*e2.r)/w; dep = (a.a*a.r+b.a*b.r+d.a*d.r+e2.a*e2.r)/w; }
  vec4 s = texture(uSeed, vUv);
  float add = s.r*uGrowth;
  pend += add;
  float tr = pend*.22; pend -= tr;
  float Rn = grown + tr;
  float k = clamp(add/max(Rn+add,1e-4)*1.5, 0., 1.);
  if(s.r > 1e-4){ hue = mix(hue, s.g/s.r, k); dep = mix(dep, s.b/s.r, max(k, R < .02 ? 1. : 0.)); }
  Rn *= uFade*(1.-uWipe); pend *= 1.-uWipe;
  o = vec4(min(Rn, 5.), hue, min(pend, 8.), dep);
}`;

const NL = 12;
const FS_SHADE = COMMON + `
in vec2 vUv;
layout(location=0) out vec4 oBub;
layout(location=1) out vec4 oVol;
uniform sampler2D uState, uGlow;
uniform vec2 uTexel, uPar, uShake;
uniform float uAspect, uTime, uFlash, uFocus, uCoc, uMaxCoc, uSpecies, uCaustics, uMotes;
uniform vec3 uLiquid, uFog, uAmbient;
uniform vec4 uLP[${NL}]; uniform vec3 uLC[${NL}]; uniform int uNL;
uniform sampler2D uEtch; uniform vec2 uEtchTexel, uBindu; uniform float uYantra, uRings, uRes;
uniform vec4 uWave[6]; uniform int uNW;
vec3 hsv(float h,float s,float v){ vec3 k = clamp(abs(fract(h+vec3(0.,2./3.,1./3.))*6.-3.)-1.,0.,1.); return v*mix(vec3(1.),k,s); }
float ridge(vec2 q){ return 1.-abs(noise(q)*2.-1.); }
vec3 lightAt(vec2 p){
  vec3 s = vec3(0.);
  for(int i=0;i<${NL};i++){ if(i>=uNL) break; vec2 d = p-uLP[i].xy; s += uLC[i]/(1.+dot(d,d)*uLP[i].w); }
  return s;
}
vec3 motes(vec2 p, float t){
  vec3 acc = vec3(0.);
  for(int l=0;l<3;l++){
    float fl = float(l), z = .12 + fl*.38;
    float cs = .055 + fl*.02;
    vec2 q = p + uPar*(z-.5)*.05 + vec2(sin(t*.04+fl*2.)*.03, -t*.006*(1.+fl*.6));
    vec2 g = q/cs, id = floor(g), f = fract(g);
    float h = hash(id + fl*17.3);
    if(h < .86) continue;
    vec2 c = vec2(hash(id+3.1+fl), hash(id+7.7-fl))*.5+.25;
    float rad = clamp(.02 + abs(z-uFocus)*uCoc*.0022, .018, .14);
    float d = length(f-c);
    float disc = smoothstep(rad, rad*.82, d);
    disc *= .55 + .45*smoothstep(rad*.3, rad*.95, d);       // brighter bokeh rim
    float e = .00018/(rad*rad+.0004);
    acc += lightAt((id+c)*cs - uPar*(z-.5)*.05) * disc * e * (.3 + .7*hash(id+1.9)) * (1.15-z*.5);
  }
  return acc;
}
void main(){
  float t = uTime;
  vec2 uv0 = vUv + uShake;
  vec2 p = (uv0-.5)*vec2(uAspect,1.);
  vec2 wob = (vec2(noise(p*4.+t*.12), noise(p*4.+9.-t*.1))-.5)*.0018;
  // pressure waves: expanding rings in the liquid that refract everything behind and inside them
  vec2 wv = vec2(0.); float wring = 0.;
  for(int i=0;i<6;i++){
    if(i>=uNW) break;
    vec2 d = p-uWave[i].xy; float dist = length(d)+1e-4;
    float b = (dist-uWave[i].z)/(.010+uWave[i].z*.045);
    float e = exp(-b*b)*uWave[i].w;
    wv += d/dist*b*e; wring += e;
  }
  wob += wv*.0032;
  vec2 uv = uv0 + wob;
  // ---- etched back glass: Sri Yantra (r) and tree rings (g); grooves only catch grazing light
  vec2 et = uEtchTexel*1.6;
  vec4 e0 = texture(uEtch, uv);
  vec4 ex1 = texture(uEtch, uv+vec2(et.x,0.)), ex2 = texture(uEtch, uv-vec2(et.x,0.));
  vec4 ey1 = texture(uEtch, uv+vec2(0.,et.y)), ey2 = texture(uEtch, uv-vec2(0.,et.y));
  vec2 gY = vec2(ex1.r-ex2.r, ey1.r-ey2.r)*uYantra;
  vec2 gR = vec2(ex1.g-ex2.g, ey1.g-ey2.g)*uRings;
  vec3 glY = vec3(0.), glR = vec3(0.);
  // ---- liquid volume
  vec3 illum = lightAt(p);
  vec3 vol = uLiquid*(.35+.65*exp(-dot(p,p)*2.5));
  for(int i=0;i<${NL};i++){
    if(i>=uNL) break;
    vec2 d = p-uLP[i].xy; float dist = length(d); float ang = atan(d.y, d.x);
    float shaft = pow(noise(vec2(ang*6.+float(i)*13.1, t*.12 + dist*.6)), 3.)*1.4 + pow(noise(vec2(ang*23.+float(i)*5., t*.05)), 6.)*1.5;
    float vk = smoothstep(.08, .3, uLP[i].z)*.9 + .1;
    vol += uLC[i]*exp(-dist*(4.2+uLP[i].w*.1))*(.01 + shaft*.03)*vk;
    vol += uLC[i]*.0007/(dist*dist + .002)*vk;
    vec2 Ld = -d/max(dist,1e-4); float att = 1./(1.+dist*dist*uLP[i].w);
    glY += uLC[i]*att*max(dot(gY, Ld), 0.);
    glR += uLC[i]*att*max(dot(gR, Ld), 0.);
  }
  vol += glY*vec3(1.,.88,.66)*.04 + glR*vec3(1.,.72,.46)*.05;
  vol += illum*(e0.r*uYantra*.0007 + e0.g*uRings*.0006);
  vol += wring*(length(gY)*vec3(1.,.8,.5)*.16 + length(gR)*vec3(.9,.6,.35)*.1) + wring*illum*.002;
  float bd = length(p-uBindu);
  vol += e0.r*uYantra*uRes*vec3(1.,.6,.24)*(.008 + .05*exp(-bd*9.)) + uRes*vec3(1.,.55,.2)*.05*exp(-bd*bd*1600.);
  vec2 cq = p*6.5 + vec2(t*.06, -t*.045);
  float caus = pow(ridge(cq)*ridge(cq*1.73+3.1), 7.);
  vol += illum*caus*.022*uCaustics;
  float px = uTexel.y*1.5;
  vec2 fc = (fract(p/.2+.5)-.5)*.2;
  float cr = max((1.-smoothstep(0.,px,abs(fc.x)))*step(abs(fc.y),.011), (1.-smoothstep(0.,px,abs(fc.y)))*step(abs(fc.x),.011));
  vol += (illum*cr*.02 + uAmbient*cr*.006)*.35;
  vol += motes(p, t)*uMotes;
  // chamber window / steel body
  float sd = pow(pow(abs(p.x)/(uAspect*.5*.965),4.)+pow(abs(p.y)/(.5*.955),4.),.25);
  float win = smoothstep(1., 1.-px*2., sd);
  vec3 steel = (uLiquid*2. + illum*.012)*(.6+.4*noise(vec2(p.x*600., p.y*4.)));
  float lip = smoothstep(1.-px*16., 1., sd)*win;
  vol = mix(steel, vol + illum*lip*.05, win);
  // ---- bubbles
  vec4 s = texture(uState, uv);
  float r = s.r, depth = s.a;
  vec2 g = vec2(texture(uState, uv+vec2(uTexel.x,0.)).r - texture(uState, uv-vec2(uTexel.x,0.)).r,
                texture(uState, uv+vec2(0.,uTexel.y)).r - texture(uState, uv-vec2(0.,uTexel.y)).r);
  float body = smoothstep(.04, .55, r);
  float edge = smoothstep(.015, .25, length(g));
  float a = max(body, edge*.85)*win;
  vec3 N = normalize(vec3(-g*3.2, 1.));
  float fres = pow(1.-N.z, 1.4);
  vec3 rim = uAmbient*fres*.8 + uAmbient*body*.05, spec = vec3(0.);
  for(int i=0;i<${NL};i++){
    if(i>=uNL) break;
    vec3 L = vec3(uLP[i].xy - p, uLP[i].z); float dl = length(L); L /= dl;
    float att = 1./(1.+dl*dl*uLP[i].w);
    rim += uLC[i]*att*fres*max(dot(N, L), 0.)*3.2;
    spec += uLC[i]*att*pow(max(dot(N, normalize(L+vec3(0.,0.,1.))), 0.), 90.)*7.;
  }
  float thick = r*1.3 + fres*1.7 + depth*.6;
  vec3 iri = .55 + .45*cos(6.2832*(thick + vec3(0.,.33,.67)));
  vec3 tint = mix(vec3(1.), hsv(s.g, .7, 1.)*1.3, uSpecies);
  vec3 bub = (uLiquid + illum*.02)*.25 + rim*mix(vec3(1.), iri, .5)*tint + spec*mix(vec3(1.), tint, .5) + uFlash*fres*vec3(.7,.8,.9)*2.;
  float fog = smoothstep(.15, 1., depth);
  bub = mix(bub, uFog*(.4 + illum*.15), fog*.55)*(1.-fog*.4);
  vec3 glow = texture(uGlow, uv).rgb*win;
  float gl2 = dot(glow, vec3(.33));
  float coc = clamp(abs(depth-uFocus)*uCoc, 0., uMaxCoc);
  oBub = vec4(bub*a + glow, a);
  oVol = vec4(vol, (a > .01 || gl2 > .004) ? coc : 0.);
}`;

// scatter-as-gather depth of field over a mipmapped bubble layer, composited on the volume
const FS_DOF = COMMON + `
in vec2 vUv; out vec4 o;
uniform sampler2D uBub, uVol; uniform vec2 uTexel; uniform float uMaxCoc, uTime;
const int N = 36;
void main(){
  vec4 v = texture(uVol, vUv);
  if(uMaxCoc < 1.5){ vec4 b = texture(uBub, vUv); o = vec4(v.rgb*(1.-clamp(b.a,0.,1.)) + b.rgb, 1.); return; }
  float R = uMaxCoc, jit = hash(gl_FragCoord.xy + fract(uTime*3.7)*17.)*6.2832;
  vec4 acc = vec4(0.);
  for(int i=0;i<N;i++){
    float fi = float(i), rr = sqrt((fi+.5)/float(N))*R, an = fi*2.39996 + jit;
    vec2 off = i==0 ? vec2(0.) : vec2(cos(an), sin(an))*rr;
    if(i==0) rr = 0.;
    vec2 uv = vUv + off*uTexel;
    float cs = texture(uVol, uv).a;
    float cover = clamp(cs - rr + 1., 0., 1.);
    if(cover <= 0.) continue;
    float lod = log2(max(cs*.55, 1.));
    vec4 b = textureLod(uBub, uv, lod);
    acc += b*cover*min(1., R*R/(float(N)*max(cs*cs, .5)));
  }
  o = vec4(v.rgb*(1.-clamp(acc.a, 0., 1.)) + acc.rgb, 1.);
}`;

const FS_BRIGHT = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform float uThresh;
void main(){ vec3 c = texture(uSrc, vUv).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c*max(l-uThresh,0.)/max(l,1e-4), 1.); }`;
const FS_BLUR = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform vec2 uDir;
void main(){ vec3 c = texture(uSrc, vUv).rgb*.227;
  c += (texture(uSrc, vUv+uDir*1.385).rgb + texture(uSrc, vUv-uDir*1.385).rgb)*.316;
  c += (texture(uSrc, vUv+uDir*3.231).rgb + texture(uSrc, vUv-uDir*3.231).rgb)*.070; o = vec4(c, 1.); }`;

const FS_FILM = COMMON + `
in vec2 vUv; out vec4 o;
uniform sampler2D uHdr, uB2, uB4, uB8, uStreak;
uniform float uAspect, uExposure, uBloom, uStreakAmt, uDirt, uGrain, uTime, uBars, uHal, uSat, uContrast, uMono, uVig, uFlicker, uDistort, uFlash;
uniform vec3 uShadow, uHigh, uStreakTint; uniform vec2 uRes;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
float dirt(vec2 uv){
  vec2 q = uv*vec2(uAspect,1.);
  float d = smoothstep(.55,.95,noise(q*2.7+1.7))*.5 + smoothstep(.6,.95,noise(q*6.3+4.2))*.35 + smoothstep(.7,1.,noise(q*17.+9.))*.25;
  vec2 gq = q*8.; vec2 id = floor(gq), f = fract(gq)-.5; float h = hash(id);
  if(h > .8){ vec2 c = (vec2(hash(id+1.3), hash(id+2.7))-.5)*.5; d += smoothstep(.22, .04, length(f-c))*(h-.8)*5.; }
  vec2 hq = q*3.; vec2 hid = floor(hq), hf = fract(hq)-.5; float hh = hash(hid+5.);
  if(hh > .7){ float rr = length(hf); d += smoothstep(.3,.27,rr)*smoothstep(.2,.29,rr)*.6; }   // ring smudge
  return d;
}
void main(){
  vec2 dc = vUv-.5;
  vec2 uv = .5 + dc*(1. - uDistort*.035 + uDistort*.12*dot(dc,dc));
  vec2 ca = dc*.006*(.4+uDistort);
  vec3 c = vec3(texture(uHdr, uv-ca).r, texture(uHdr, uv).g, texture(uHdr, uv+ca).b);
  vec3 b2 = texture(uB2, uv).rgb, b4 = texture(uB4, uv).rgb, b8 = texture(uB8, uv).rgb;
  c += (b2*.25 + b4*.4 + b8*.55)*uBloom;
  c += b2*vec3(1.,.22,.08)*uHal*.7;
  vec3 st = texture(uStreak, uv).rgb;
  c += (dot(st, vec3(.33))*uStreakTint*1.3 + st*.25)*uStreakAmt;
  c += (b4*.5 + b8*1.1)*dirt(uv)*uDirt;
  float fl = 1. + uFlicker*(noise(vec2(uTime*9., 3.))-.5)*.12;
  c *= uExposure*fl*(1. + uFlash*.25);
  c = aces(c);
  float l = dot(c, vec3(.2126,.7152,.0722));
  c = mix(c, vec3(l), uMono);
  c = max(mix(vec3(l), c, uSat), 0.);
  c *= mix(uShadow, uHigh, smoothstep(.02, .6, l));
  c = pow(clamp(c, 0., 1.), vec3(1./2.2));
  c = mix(c, c*c*(3.-2.*c), uContrast);
  c *= 1. - uVig*dot(dc,dc)*1.7;
  float gr = hash(vUv*uRes + fract(uTime*7.13)*91.) + hash(vUv*uRes*.5 + fract(uTime*3.1)*37.) - 1.;
  c += gr*uGrain*(.35 + .65*(1.-abs(l*2.-1.)));
  float bars = step(.5-uBars, abs(dc.y));
  c = mix(c, vec3(0.), bars);
  o = vec4(c, 1.);
}`;

const prg = {
  deposit: program(VS_DEPOSIT, FS_DEPOSIT), glow: program(VS_GLOW, FS_GLOW), fade: program(VS_FULL, FS_FADE),
  evolve: program(VS_FULL, FS_EVOLVE), shade: program(VS_FULL, FS_SHADE), dof: program(VS_FULL, FS_DOF),
  bright: program(VS_FULL, FS_BRIGHT), blur: program(VS_FULL, FS_BLUR), film: program(VS_FULL, FS_FILM),
};
const emptyVao = gl.createVertexArray();

function spriteBuffer(max) {
  const data = new Float32Array(max * 6), vao = gl.createVertexArray(), buf = gl.createBuffer();
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
  gl.bindVertexArray(null);
  return { data, vao, buf, n: 0, max };
}
const BUB = spriteBuffer(120000), GLOW = spriteBuffer(60000);

// ---------------------------------------------------------------- sizing
let W = 0, H = 0, S = 1, DPR = 1, simScale = 1, quality = 1, RW = 0, RH = 0;
let stA, stB, seed, glowT, shadeT, hdr, b2a, b2b, b4a, b4b, b8a, b8b, s4a, s4b;
function allocTargets(keep) {
  const old = keep ? stA : null;
  if (old) { stA = null; }
  [stA, stB, seed, glowT, shadeT, hdr, b2a, b2b, b4a, b4b, b8a, b8b, s4a, s4b].forEach(freeTarget);
  RW = Math.round(W * simScale); RH = Math.round(H * simScale);
  glc.width = RW; glc.height = RH;
  stA = target(RW, RH); stB = target(RW, RH); seed = target(RW, RH); glowT = target(RW, RH);
  shadeT = target(RW, RH, { mrt: true, mips: true }); hdr = target(RW, RH);
  b2a = target(RW / 2, RH / 2); b2b = target(RW / 2, RH / 2);
  b4a = target(RW / 4, RH / 4); b4b = target(RW / 4, RH / 4);
  b8a = target(RW / 8, RH / 8); b8b = target(RW / 8, RH / 8);
  s4a = target(RW / 4, RH / 4); s4b = target(RW / 4, RH / 4);
  if (old) {   // keep the bubbles when only the render resolution changes
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, old.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, stA.fbo);
    gl.blitFramebuffer(0, 0, old.w, old.h, 0, 0, RW, RH, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    freeTarget(old);
  }
}
function resize() {
  W = innerWidth; H = innerHeight; S = Math.min(W, H);
  DPR = Math.min(devicePixelRatio || 1, 2);
  simScale = Math.min(DPR, 2200 / Math.max(W, H)) * quality;
  uic.width = Math.round(W * DPR); uic.height = Math.round(H * DPR);
  allocTargets(false);
  field.resize();
  bindu.x = bindu.rx * W; bindu.y = bindu.ry * H;
  etchResize();
}

// ---------------------------------------------------------------- chamber geometry
function inWindow(x, y) {
  const px = (x / W - .5) * (W / H), py = (y / H - .5);
  const a = W / H * .5 * .965, b = .5 * .955;
  return Math.pow(Math.pow(Math.abs(px) / a, 4) + Math.pow(Math.abs(py) / b, 4), .25) < 0.995;
}
function edgePoint(ang, inset = 18) {
  let lo = 0, hi = Math.max(W, H);
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; inWindow(W / 2 + Math.cos(ang) * m, H / 2 + Math.sin(ang) * m) ? lo = m : hi = m; }
  return [W / 2 + Math.cos(ang) * (lo - inset), H / 2 + Math.sin(ang) * (lo - inset)];
}
const toP = (x, y) => [(x / W - .5) * (W / H), .5 - y / H];   // css px -> shader p-space

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
    const c = this.cell, rr = Math.ceil(r * 2 / c), cx = Math.round(x / c), cy = Math.round(y / c);
    for (let j = cy - rr; j <= cy + rr; j++) for (let i = cx - rr; i <= cx + rr; i++) {
      if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) continue;
      const dx = i * c - x, dy = j * c - y, k = j * this.gw + i;
      this.g[k] = clamp(this.g[k] + amt * Math.exp(-(dx * dx + dy * dy) / (2 * r * r)), -4, 4);
    }
  },
  clear() { this.g.fill(0); },
};

// ---------------------------------------------------------------- lights (interactive colour layer)
const lamps = [];
const flashes = [];        // transient event lights
let selLamp = null;
function addLamp(ang, hue, sat = .85, int = 1.3) {
  const [x, y] = edgePoint(ang, -6);
  const l = { x, y, rx: x / W, ry: y / H, hue, sat, int, th: hue, ts: sat, ti: int, on: true };
  lamps.push(l); return l;
}
function addFlash(x, y, rgb, int, life = 0.6, reach = 60) {
  if (flashes.length > 5) flashes.shift();
  flashes.push({ x, y, rgb, int, t: 0, life, reach });
}
const torch = { x: -1, y: -1, a: 0 };
const LP = new Float32Array(NL * 4), LC = new Float32Array(NL * 3);
let nLights = 0;
function packLights(dt) {
  nLights = 0;
  const put = (x, y, z, w, rgb, k) => {
    if (nLights >= NL) return; const [px, py] = toP(x, y), i = nLights++;
    LP.set([px, py, z, w], i * 4); LC.set([rgb[0] * k, rgb[1] * k, rgb[2] * k], i * 3);
  };
  for (const l of lamps) if (l.on) put(l.x, l.y, .32, 1.6, hsvLin(l.hue, l.sat, 1), l.int);
  if (P.torch && torch.a > 0.01) put(torch.x, torch.y, .09, 30, hsvLin(P.torchHue, .55, 1), 1.1 * torch.a);
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i]; f.t += dt; const k = Math.max(0, 1 - f.t / f.life);
    if (k <= 0) { flashes.splice(i, 1); continue; }
    put(f.x, f.y, .04, f.reach, f.rgb, f.int * k * k);
  }
}

// ---------------------------------------------------------------- sacred geometry layer
// One centre holds all three forms: the bindu of the yantra, the pith of the tree, the first seed of a cone.
const GOLD = Math.PI * (3 - Math.sqrt(5));                 // 137.508°
const FIB = new Set([1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377]);
const bindu = { x: 0, y: 0, rx: .5, ry: .5 };
let resonance = 0;

// --- etched back glass (yantra in red, rings in green), redrawn only when something changes
const etch = { cv: document.createElement('canvas'), tex: null, k: 1, dirty: true, t: 0 };
etch.g = etch.cv.getContext('2d');
function etchResize() {
  etch.k = Math.min(DPR, 1.5);
  etch.cv.width = Math.max(1, Math.round(W * etch.k)); etch.cv.height = Math.max(1, Math.round(H * etch.k));
  if (!etch.tex) etch.tex = gl.createTexture();
  etch.dirty = true;
}
// Sri Yantra: 4 upward (Shiva) and 5 downward (Shakti) triangles as [baseY, apexY, width] in units of the inner circle
const YUP = [[-.62, .97, 1], [-.43, .63, .8], [-.27, .43, .63], [-.08, .23, .46]];
const YDN = [[.70, -.97, 1], [.50, -.65, .81], [.32, -.46, .65], [.15, -.29, .5], [.03, -.13, .34]];
function yantra(g, cx, cy, R) {
  const tri = ([b, a, w], up) => {
    const hw = Math.sqrt(Math.max(0, 1 - b * b)) * w;
    g.beginPath(); g.moveTo(cx - hw * R, cy - b * R); g.lineTo(cx + hw * R, cy - b * R); g.lineTo(cx, cy - a * R); g.closePath(); g.stroke();
    void up;
  };
  YUP.forEach(t => tri(t, 1)); YDN.forEach(t => tri(t, 0));
  const circle = r => { g.beginPath(); g.arc(cx, cy, r * R, 0, 6.2832); g.stroke(); };
  const petals = (n, r0, r1, off) => {
    for (let i = 0; i < n; i++) {
      const th = off + i * 6.2832 / n, hw = Math.PI / n * .96;
      const P0 = [cx + Math.cos(th - hw) * r0 * R, cy + Math.sin(th - hw) * r0 * R], P1 = [cx + Math.cos(th + hw) * r0 * R, cy + Math.sin(th + hw) * r0 * R];
      const T = [cx + Math.cos(th) * r1 * R, cy + Math.sin(th) * r1 * R];
      const c0 = [cx + Math.cos(th - hw * .85) * (r1 - .04) * R, cy + Math.sin(th - hw * .85) * (r1 - .04) * R];
      const c1 = [cx + Math.cos(th + hw * .85) * (r1 - .04) * R, cy + Math.sin(th + hw * .85) * (r1 - .04) * R];
      g.beginPath(); g.moveTo(...P0); g.quadraticCurveTo(...c0, ...T); g.quadraticCurveTo(...c1, ...P1); g.stroke();
    }
  };
  circle(1.03); petals(8, 1.06, 1.4, -Math.PI / 2); circle(1.43);
  petals(16, 1.46, 1.74, -Math.PI / 2); circle(1.77); circle(1.84); circle(1.89); circle(1.94);
  // bhupura: three nested squares, each with four T-shaped gates
  for (const sq of [2.1, 2.18, 2.26]) {
    const sR = sq * R, gw = .2 * R, d = .1 * R + (sq - 2.1) * R, w = .1 * R, h = .1 * R;
    const side = [[-sR, -sR], [-gw, -sR], [-gw, -sR - d], [-gw - w, -sR - d], [-gw - w, -sR - d - h], [gw + w, -sR - d - h], [gw + w, -sR - d], [gw, -sR - d], [gw, -sR], [sR, -sR]];
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const c = Math.cos(k * Math.PI / 2), sn = Math.sin(k * Math.PI / 2);
      side.forEach(([x, y], i) => { const X = cx + x * c - y * sn, Y = cy + x * sn + y * c; (k === 0 && i === 0) ? g.moveTo(X, Y) : g.lineTo(X, Y); });
    }
    g.closePath(); g.stroke();
  }
  g.beginPath(); g.arc(cx, cy, 1.6, 0, 6.2832); g.fill();
}
const NB = 120;   // angular bins of the tree
const tree = { rings: [], cur: new Float32Array(NB), bias: new Float32Array(NB), vari: new Float32Array(NB), t: 0, age: 0, rays: [] };
function seedTree() {
  tree.rings = []; tree.cur.fill(3); tree.bias.fill(0); tree.t = 0; tree.age = 0;
  const ph = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
  for (let i = 0; i < NB; i++) { const a = i / NB * 6.2832; tree.vari[i] = 1 + .16 * Math.sin(a + ph[0]) + .07 * Math.sin(2 * a + ph[1]) + .04 * Math.sin(5 * a + ph[2]); }
  tree.rays = Array.from({ length: 22 }, () => [rand() * 6.2832, .15 + rand() * .5, .3 + rand() * .5]);
  for (let k = 0; k < 7; k++) { treeGrow(6.5, .6 + rand() * .9); }
  etch.dirty = true;
}
function treeGrow(dt, act) {
  const c = tree.cur, b = tree.bias;
  for (let i = 0; i < NB; i++) c[i] += P.ringRate * 6 * act * (1 + b[i]) * tree.vari[i] * dt / Math.sqrt(1 + c[i] / 70);
  for (let i = 0; i < NB; i++) b[i] *= Math.exp(-dt * .08);
  tree.t += dt;
  const period = P.pulsed ? CYCLE * 2 : 6.5;
  if (tree.t >= period) {
    tree.t = 0; tree.age++;
    tree.rings.push(Float32Array.from(c, (r, i) => r * (1 + .012 * Math.sin(i * .9 + tree.age * 1.7))));
    etch.dirty = true;
    let mx = 0; for (const r of c) mx = Math.max(mx, r);
    if (mx > Math.hypot(W, H) * .5) { logEvent(`tree felled at <em>${tree.age}</em> rings · a seedling starts at the bindu`); seedTree(); }
  }
}
function treeBias(ang, amt) {
  for (let i = 0; i < NB; i++) {
    let d = Math.abs(i / NB * 6.2832 - ang) % 6.2832; d = Math.min(d, 6.2832 - d);
    tree.bias[i] = Math.min(tree.bias[i] + amt * Math.exp(-d * d / .18), 2.5);
  }
}
function drawEtch() {
  const g = etch.g, k = etch.k;
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000'; g.fillRect(0, 0, etch.cv.width, etch.cv.height);
  g.setTransform(k, 0, 0, k, 0, 0); g.globalCompositeOperation = 'lighter'; g.lineJoin = 'round';
  const cx = bindu.x, cy = bindu.y;
  // tree rings: latewood lines, faint earlywood grain between, medullary rays, the living cambium edge
  const ringPath = (r, scale = 1) => { g.beginPath(); for (let i = 0; i <= NB; i++) { const a = i / NB * 6.2832, rr = r[i % NB] * scale; i ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.stroke(); };
  let prev = null;
  for (const r of tree.rings) {
    if (prev) { g.strokeStyle = 'rgb(0,55,0)'; g.lineWidth = .8; for (const f of [.4, .7]) { g.beginPath(); for (let i = 0; i <= NB; i++) { const a = i / NB * 6.2832, rr = prev[i % NB] + (r[i % NB] - prev[i % NB]) * f; i ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.stroke(); } }
    g.strokeStyle = 'rgb(0,190,0)'; g.lineWidth = 1.6; ringPath(r);
    prev = r;
  }
  g.strokeStyle = 'rgb(0,80,0)'; g.lineWidth = 1; ringPath(tree.cur);
  const outer = prev || tree.cur;
  g.strokeStyle = 'rgb(0,60,0)'; g.lineWidth = .8;
  for (const [a, r0, len] of tree.rays) { const i = Math.round(a / 6.2832 * NB) % NB, R = outer[i]; g.beginPath(); g.moveTo(cx + Math.cos(a) * R * r0, cy + Math.sin(a) * R * r0); g.lineTo(cx + Math.cos(a) * R * Math.min(1, r0 + len), cy + Math.sin(a) * R * Math.min(1, r0 + len)); g.stroke(); }
  // yantra
  g.strokeStyle = g.fillStyle = 'rgb(255,0,0)'; g.lineWidth = 1.1;
  yantra(g, cx, cy, S * .078);
  gl.bindTexture(gl.TEXTURE_2D, etch.tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, etch.cv);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  etch.dirty = false;
}

// --- pressure waves: every interaction rings the liquid
const waves = [];
const WV = new Float32Array(24);
function addWave(x, y, amp) {
  if (P.waves <= 0) return;
  if (waves.length >= 6) waves.shift();
  waves.push({ x, y, r: 0, amp: amp * P.waves, reached: Math.hypot(x - bindu.x, y - bindu.y) < 8 });
}
function updateWaves(dt) {
  for (let i = waves.length - 1; i >= 0; i--) {
    const w = waves[i]; w.r += 300 * dt; w.amp *= Math.exp(-dt * .75);
    if (!w.reached && w.r >= Math.hypot(w.x - bindu.x, w.y - bindu.y)) {   // the wave reaches the heartwood: the tree leans toward its source
      w.reached = true; treeBias((Math.atan2(w.y - bindu.y, w.x - bindu.x) + 6.2832) % 6.2832, w.amp * .9);
    }
    if (w.amp < .02 || w.r > Math.hypot(W, H)) waves.splice(i, 1);
  }
  WV.fill(0);
  waves.forEach((w, i) => { const [px, py] = toP(w.x, w.y); WV.set([px, py, w.r / H, w.amp], i * 4); });
}

// --- seed heads: golden-angle florets, Fibonacci electrons
const cones = [];
function addCone(x, y) {
  cones.push({ x, y, z: focusCur, n: 0, N: P.florets, c: P.floretSpacing, acc: 0, rot: rand() * 6.2832, pts: [], born: simTime, done: false });
  addWave(x, y, .5);
  logEvent(`seed head · golden angle <em>137.5°</em>`);
}
function emitFloret(x, y, size, inten, hue, z) {
  const B = BUB; if (B.n >= B.max) return; const k = B.n * 6;
  B.data.set([x, y, size, inten, hue, z], k); B.n++; bubblesThisSec++;
}
function updateCones(dt) {
  for (let i = cones.length - 1; i >= 0; i--) {
    const c = cones[i];
    if (!c.done) {
      c.acc += dt * 80 * P.speed;
      while (c.acc >= 1 && c.n < c.N) {
        c.acc -= 1; c.n++;
        const th = c.n * GOLD + c.rot, r = c.c * Math.sqrt(c.n), fx = c.x + Math.cos(th) * r, fy = c.y + Math.sin(th) * r;
        c.pts.push(fx, fy);
        if (!inWindow(fx, fy)) continue;
        const sz = (1.3 + .19 * Math.sqrt(c.n)) * simScale * P.size;
        emitFloret(fx, fy, sz, .55 + .25 * Math.sqrt(c.n / c.N), .08 + .25 * c.n / c.N, c.z);
        if (FIB.has(c.n) && P.fibElectrons) {
          spawn('e-', fx, fy, -Math.sin(th), Math.cos(th), 1.5 + c.n * .055, null, c.z, gauss() * .05);
          addFlash(fx, fy, [1.4, .9, .45], .5 + Math.sqrt(c.n) * .08, .5, 160);
        }
      }
      if (c.n >= c.N) { c.done = true; logEvent(`${c.N} florets · parastichies <em>8 · 13 · 21</em>`); }
    } else if (simTime - c.born > Math.log(0.04) / Math.log(fadeRate()) / 60 + 3) cones.splice(i, 1);
  }
}

// ---------------------------------------------------------------- physics
const MAXP = 2600, STEP = 0.9;
const K_LOSS = 5.0;          // MeV per chamber-size for minimum-ionising |q|=1
const CURV = 330;            // r_px = p * S / (CURV * |q| * B)
const particles = [], tracks = [];
let trackId = 0, bubblesThisSec = 0, bubRate = 0, simTime = 0, sens = 1, flash = 0, wipe = 0, shake = 0, lastEventZ = .5;

function newTrack(sp, parent, x, y, z, p) {
  const t = { id: ++trackId, sp, parent, kids: [], pts: [x, y, z], p0: p, born: simTime, died: 0, end: '', len: 0, alive: true };
  if (parent) parent.kids.push(t);
  tracks.push(t);
  return t;
}
const lastZ = t => t.pts[t.pts.length - 1];
function spawn(sp, x, y, dx, dy, p, parent = null, z, dz) {
  if (particles.length >= MAXP || !(p > 0)) return null;
  const s = SP[sp], l = Math.hypot(dx, dy) || 1, E = Math.sqrt(p * p + s.m * s.m);
  if (z === undefined) z = parent ? lastZ(parent) : .5;
  if (dz === undefined) dz = parent ? gauss() * .35 : 0;
  const o = { sp, s, x, y, z, dz, dx: dx / l, dy: dy / l, p, E, beta: s.m ? p / E : 1, acc: rand(), gacc: 0, ptAcc: 0, alive: true, hit: null };
  o.track = newTrack(sp, parent, x, y, z, p);
  particles.push(o);
  return o;
}
function spawnVec(sp, x, y, px, py, parent) { return spawn(sp, x, y, px, py, Math.hypot(px, py), parent); }

function twoBody(o, M, m1, m2) {
  const ps = Math.sqrt(Math.max(0, (M * M - (m1 + m2) ** 2) * (M * M - (m1 - m2) ** 2))) / (2 * M);
  const th = rand() * 6.283185, ppar = ps * Math.cos(th), pperp = ps * Math.sin(th);
  const E = Math.sqrt(o.p * o.p + M * M), g = E / M, bg = o.p / M;
  const e1 = Math.sqrt(ps * ps + m1 * m1), e2 = Math.sqrt(ps * ps + m2 * m2);
  const a1 = g * ppar + bg * e1, a2 = -g * ppar + bg * e2, nx = -o.dy, ny = o.dx;
  return [[o.dx * a1 + nx * pperp, o.dy * a1 + ny * pperp], [o.dx * a2 - nx * pperp, o.dy * a2 - ny * pperp]];
}
function kill(o, why) {
  if (!o.alive) return;
  o.alive = false; o.track.alive = false; o.track.died = simTime; o.track.end = why;
  o.track.pts.push(o.x, o.y, o.z);
}
function logEvent(html) {
  const el = document.createElement('div'); el.innerHTML = html;
  const log = $('#log'); log.prepend(el);
  while (log.children.length > 7) log.lastChild.remove();
  [...log.children].forEach((c, i) => c.classList.toggle('old', i > 3));
}
const speciesRGB = sp => hsvLin(((SP[sp] && SP[sp].hue) || .6) * 360, .75, 1);

function decay(o, inFlight) {
  const { sp, x, y } = o, t = o.track, M = o.s.m;
  if (!inFlight) o.p = 0;
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
      if (rand() < 0.64) { const [a] = twoBody(o, M, 105.66, 0); spawnVec('mu' + ch, x, y, a[0], a[1], t); txt = `${o.s.sym} → <em>μ${ch === '+' ? '⁺' : '⁻'}</em> ν`; }
      else { const [a, b] = twoBody(o, M, 139.57, 134.98); spawnVec('pi' + ch, x, y, a[0], a[1], t); pi0(x, y, b[0], b[1], t); txt = `${o.s.sym} → <em>π${ch === '+' ? '⁺' : '⁻'} π⁰</em>`; }
      break;
    }
    case 'K0': { const [a, b] = twoBody(o, M, 139.57, 139.57); spawnVec('pi+', x, y, a[0], a[1], t); spawnVec('pi-', x, y, b[0], b[1], t); txt = `K⁰ → <em>π⁺ π⁻</em> (V⁰)`; break; }
    case 'L0': { const [a, b] = twoBody(o, M, 938.27, 139.57); spawnVec('p', x, y, a[0], a[1], t); spawnVec('pi-', x, y, b[0], b[1], t); txt = `Λ⁰ → <em>p π⁻</em> (V⁰)`; break; }
    case 'e+': { const th = rand() * 6.283; spawn('gamma', x, y, Math.cos(th), Math.sin(th), 0.511, t); spawn('gamma', x, y, -Math.cos(th), -Math.sin(th), 0.511, t); txt = `e⁺e⁻ → <em>γγ</em> annihilation`; break; }
    case 'pbar': nuclearStar(o, 'annihilation'); return;
    default: return;
  }
  kill(o, inFlight ? 'decay' : 'decay at rest');
  addFlash(x, y, speciesRGB(sp), sp === 'e+' ? 1.4 : 0.9, .45, 90);
  addWave(x, y, .22);
  lastEventZ = o.z;
  if (txt) { logEvent(txt); audio.ping(sp); }
}
function pi0(x, y, px, py, parent) {
  const l = Math.hypot(px, py) || 1, fake = { p: l, dx: px / l, dy: py / l };
  const [a, b] = twoBody(fake, 134.98, 0, 0);
  spawnVec('gamma', x, y, a[0], a[1], parent); spawnVec('gamma', x, y, b[0], b[1], parent);
}
function pair(o) {
  const avail = o.E - 1.022; if (avail <= 0) return;
  const f = 0.08 + 0.84 * rand(), open = 0.02 + 0.07 * rand(), ca = Math.cos(open), sa = Math.sin(open);
  const p1 = Math.sqrt((f * avail + .511) ** 2 - .261), p2 = Math.sqrt(((1 - f) * avail + .511) ** 2 - .261);
  const dz = gauss() * .15;
  spawn('e-', o.x, o.y, o.dx * ca - o.dy * sa, o.dy * ca + o.dx * sa, p1, o.track, o.z, dz + .03);
  spawn('e+', o.x, o.y, o.dx * ca + o.dy * sa, o.dy * ca - o.dx * sa, p2, o.track, o.z, dz - .03);
  kill(o, 'pair conversion'); logEvent(`γ → <em>e⁺ e⁻</em> ${fmtE(o.E)}`); audio.ping('pair');
  addFlash(o.x, o.y, [.35, .7, 1.6], 1.6, .5, 120); lastEventZ = o.z;
  addWave(o.x, o.y, .35);
}
function nuclearStar(o, kind) {
  const Tin = kind === 'annihilation' ? 1876 + (o.E - o.s.m) : kind === 'capture' ? 140 : Math.max(60, (o.E - o.s.m) * 0.85);
  const n = clamp(2 + Math.floor(rand() * (1 + Tin / 220)), 2, 10);
  const mix = kind === 'annihilation' ? [['pi+', 40], ['pi-', 40], ['gamma', 20]]
    : Tin < 200 ? [['p', 60], ['alpha', 20], ['gamma', 20]]
    : [['p', 34], ['pi+', 18], ['pi-', 18], ['gamma', 10], ['K0', 6], ['L0', 6], ['K+', 4], ['alpha', 4]];
  const w = []; let tw = 0; for (let i = 0; i < n; i++) { const r = -Math.log(rand() + 1e-6); w.push(r); tw += r; }
  const fwd = Math.atan2(o.dy, o.dx), spread = kind === 'interaction' ? 0.9 : 3.2;
  for (let i = 0; i < n; i++) {
    const sp = pick(mix), m = SP[sp].m, T = Tin * w[i] / tw, p = m ? Math.sqrt(T * T + 2 * T * m) : T;
    const a = fwd + (kind === 'interaction' ? gauss() * spread : rand() * 6.283);
    spawn(sp, o.x, o.y, Math.cos(a), Math.sin(a), Math.max(p, 5), o.track, o.z);
  }
  kill(o, kind === 'interaction' ? 'nuclear interaction' : kind);
  logEvent(`${o.s.sym} ${kind} · <em>${n}-prong star</em>`); audio.star(n);
  addFlash(o.x, o.y, kind === 'annihilation' ? [1.6, .35, 1.1] : [1.7, .75, .28], 2.4 + n * .25, .9, 40);
  shake = Math.min(shake + n * .0007, .006); lastEventZ = o.z;
  addWave(o.x, o.y, .6 + n * .08);
}

function emitBubble(x, y, ion, hue, z) {
  const B = BUB; if (B.n >= B.max) return;
  const k = B.n * 6, j = 0.55;
  B.data[k] = x + gauss() * j; B.data[k + 1] = y + gauss() * j;
  B.data[k + 2] = Math.max(1.6, (1.15 + 0.2 * Math.sqrt(Math.min(ion, 30))) * simScale * P.size * (0.75 + 0.5 * rand()));
  B.data[k + 3] = (0.65 + 0.5 * rand()) / (1 + ion * 0.04);
  B.data[k + 4] = hue; B.data[k + 5] = z;
  B.n++; bubblesThisSec++;
}
// ionisation glow: colour by velocity — Cherenkov violet-blue above threshold, cooling to amber for slow, dense ionisers
function emitGlow(o, ion) {
  const B = GLOW; if (B.n >= B.max || P.glow <= 0) return;
  const b = o.beta, k = B.n * 6;
  let r, g, bl;
  if (b > 0.9) { r = .22; g = .42; bl = 1.6; }
  else { const t = clamp((b - .15) / .75, 0, 1); r = 1.7 - 1.3 * t; g = .55 + .2 * t; bl = .12 + 1.1 * t * t; }
  const inten = P.glow * (.22 + Math.min(ion, 12) * .035) * (1 - o.z * .5);
  B.data[k] = o.x; B.data[k + 1] = o.y; B.data[k + 2] = (5 + Math.min(ion, 16) * .35) * simScale;
  B.data[k + 3] = r * inten; B.data[k + 4] = g * inten; B.data[k + 5] = bl * inten;
  B.n++;
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
      const ion = q * q * Math.min(1 / (o.beta * o.beta), 30);
      o.E -= K_LOSS * P.density * ion * dsS * (s.m < 1 ? 1 + 6 / Math.max(o.p, 0.5) : 1);
      if (o.E - s.m <= (s.m < 1 ? 0.04 : 0.6)) { o.x += o.dx * ds; o.y += o.dy * ds; stop(o); return; }
      o.p = Math.sqrt(o.E * o.E - s.m * s.m); o.beta = o.p / o.E;
      o.acc += 0.38 * P.bubbles * Math.min(ion, 9) * ds * sens;
      while (o.acc >= 1) { o.acc -= 1; emitBubble(o.x + o.dx * rand() * ds, o.y + o.dy * rand() * ds, ion, s.hue, o.z); }
      if ((o.gacc += ds) > 2.2) { o.gacc = 0; emitGlow(o, ion); }
      if (o.p > 25 && rand() < 2.2 * q * q * dsS * P.density) {
        const pd = 0.5 + 6 * rand() * rand(), a = (rand() < .5 ? 1 : -1) * (1.0 + 0.45 * rand()), ca = Math.cos(a), sa = Math.sin(a);
        spawn('e-', o.x, o.y, o.dx * ca - o.dy * sa, o.dy * ca + o.dx * sa, pd, o.track, o.z);
        o.E -= pd * .3;
      }
      if (s.m < 1 && o.p > 6 && rand() < 0.9 * dsS * P.density) {
        const k = o.E * (0.08 + 0.45 * rand());
        spawn('gamma', o.x, o.y, o.dx, o.dy, k, o.track, o.z, o.dz);
        o.E -= k; if (o.E - s.m <= 0.05) { stop(o); return; }
        o.p = Math.sqrt(o.E * o.E - s.m * s.m); o.beta = o.p / o.E;
      }
    } else if (s.m === 0) {
      if (o.E > 1.03 && rand() < dsS * 0.75 * P.density) { pair(o); return; }
    }
    if (s.ctau && rand() < dsS / ((o.p / s.m) * s.ctau)) { decay(o, true); return; }
    o.x += o.dx * ds; o.y += o.dy * ds; o.z += o.dz * dsS;
    o.track.len += ds;
    if ((o.ptAcc += ds) > 3) { o.ptAcc = 0; o.track.pts.push(o.x, o.y, o.z); }
    if (!inWindow(o.x, o.y) || o.z < 0 || o.z > 1) { kill(o, 'left chamber'); return; }
    if (q && !o.bd && (o.x - bindu.x) ** 2 + (o.y - bindu.y) ** 2 < 49) {
      o.bd = true;
      if (resonance < .25) { logEvent(`${s.sym} threads the <em>bindu</em>`); addWave(bindu.x, bindu.y, .45); audio.ping('L0'); }
      resonance = 1;
    }
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
  if (['pi+', 'pi-', 'mu+', 'mu-', 'K+', 'K-', 'e+', 'pbar'].includes(o.sp)) decay(o, false);
  else kill(o, 'stopped');
}

// ---------------------------------------------------------------- scene objects
const emitters = [], targets = [], sources = [];
let emId = 0;
function addEmitter(ang, sp = 'mix', p = 900, rate = 1.4, z = .5) {
  const [x, y] = edgePoint(ang);
  const e = { id: ++emId, x, y, a: ang + Math.PI, sp, p, rate, acc: 0, rx: x / W, ry: y / H, z };
  emitters.push(e); buildEmitterUI(); return e;
}
function fireEmitter(e, n = 1) {
  for (let i = 0; i < n; i++) {
    const sp = e.sp === 'mix' ? pick(BEAM_MIX) : e.sp, a = e.a + gauss() * 0.012, off = gauss() * 5;
    spawn(sp, e.x - Math.sin(e.a) * off, e.y + Math.cos(e.a) * off, Math.cos(a), Math.sin(a), e.p * (1 + gauss() * 0.03), null, clamp(e.z + gauss() * .03, .02, .98), gauss() * .02);
  }
}
function cosmic() {
  const a = Math.PI / 2 + gauss() * 0.35;
  let px = W * (0.1 + 0.8 * rand()), py = 0;
  for (let i = 0; i < 400 && !inWindow(px, py); i++) { px += Math.cos(a) * 4; py += Math.sin(a) * 4; }
  if (!inWindow(px, py)) return;
  spawn(rand() < .55 ? 'mu-' : 'mu+', px, py, Math.cos(a), Math.sin(a), 400 + 3000 * rand() * rand(), null, .1 + .8 * rand(), gauss() * .25);
}
function sourceEmit(src) {
  const type = src.type === 'mixed' ? (rand() < .65 ? 'beta' : 'alpha') : src.type, a = rand() * 6.283;
  if (type === 'alpha') { const T = 4 + 5 * rand(); spawn('alpha', src.x, src.y, Math.cos(a), Math.sin(a), Math.sqrt(T * T + 2 * T * 3727.4), null, src.z, gauss() * .3); }
  else { const T = 0.3 + 4 * rand() * rand(); spawn(rand() < .8 ? 'e-' : 'e+', src.x, src.y, Math.cos(a), Math.sin(a), Math.sqrt(T * T + 2 * T * .511), null, src.z, gauss() * .3); }
}
function spark(x, y) {
  const r = rand(), a = rand() * 6.283, z = focusCur;
  const fake = { x, y, z, dx: Math.cos(a), dy: Math.sin(a), s: SP.p, E: 1600, sp: 'p', alive: true };
  fake.track = newTrack('p', null, x, y, z, 0);
  if (r < 0.35) { const g = spawn('gamma', x, y, fake.dx, fake.dy, 20 + 200 * rand(), null, z, 0); if (g) pair(g); }
  else if (r < 0.6) { const k = spawn(rand() < .5 ? 'K0' : 'L0', x, y, fake.dx, fake.dy, 300 + 500 * rand(), null, z, 0); if (k) decay(k, true); }
  else nuclearStar(fake, 'interaction');
  tracks.splice(tracks.indexOf(fake.track), 1);
}

// ---------------------------------------------------------------- pulsed expansion cycle
const CYCLE = 3.2;
let cyclePhase = 0, flashed = false;
function updateCycle(dt) {
  if (!P.pulsed) { sens = 1; wipe = 0; flash *= 0.85; return; }
  cyclePhase = (cyclePhase + dt / CYCLE) % 1;
  sens = cyclePhase < 0.22 ? 1 : 0;
  if (cyclePhase < 0.02) flashed = false;
  if (cyclePhase > 0.06 && !flashed) { flashed = true; flash = 1; for (const e of emitters) fireEmitter(e, 2 + Math.round(e.rate * 2)); audio.thump(); }
  flash *= 0.86;
  wipe = cyclePhase > 0.78 && cyclePhase < 0.9 ? 0.06 : 0;
}

// ---------------------------------------------------------------- simulation tick
let lastPrune = 0;
const fadeRate = () => 1 - (0.03 * Math.pow(0.012, P.persistence));
function simulate(dt) {
  const f = Math.min(dt * 60, 3);
  simTime += dt;
  updateCycle(dt);
  if (!P.pulsed) for (const e of emitters) { e.acc += e.rate * dt; while (e.acc >= 1) { e.acc -= 1; fireEmitter(e); } }
  if (P.cosmics && rand() < dt * 0.45) cosmic();
  for (const s of sources) { s.acc += P.sourceRate * dt; while (s.acc >= 1) { s.acc -= 1; sourceEmit(s); } }
  updateCones(dt);
  treeGrow(dt, clamp(.25 + bubRate / 4000, .25, 2.2));
  if ((etch.t += dt) > 1) { etch.t = 0; etch.dirty = true; }
  resonance *= Math.exp(-dt / 2.2);
  for (let i = 0; i < particles.length; i++) stepParticle(particles[i], f);
  for (let i = particles.length - 1; i >= 0; i--) if (!particles[i].alive) { particles[i] = particles[particles.length - 1]; particles.pop(); }
  if (simTime - lastPrune > 0.5) {
    lastPrune = simTime;
    const life = Math.log(0.04) / Math.log(fadeRate()) / 60 + 0.5;
    for (let i = tracks.length - 1; i >= 0; i--) { const t = tracks[i]; if (!t.alive && simTime - t.died > life && t !== pinned) tracks.splice(i, 1); }
    while (tracks.length > 2500) { const i = tracks.findIndex(t => !t.alive && t !== pinned); if (i < 0) break; tracks.splice(i, 1); }
  }
}

// ---------------------------------------------------------------- camera: autofocus, grade lerp, shake
let focusCur = .5, focusTgt = .5, parX = 0, parY = 0;
function nearestDepth(x, y, rad) {
  let best = null, bd = rad * rad;
  for (const o of particles) { if (!o.s.q) continue; const d = (o.x - x) ** 2 + (o.y - y) ** 2; if (d < bd) { bd = d; best = o.z; } }
  for (const t of tracks) {
    const p = t.pts;
    for (let i = 0; i < p.length; i += 9) { const d = (p[i] - x) ** 2 + (p[i + 1] - y) ** 2; if (d < bd) { bd = d; best = p[i + 2]; } }
  }
  return best;
}
let afT = 0;
function updateCamera(dt) {
  if (P.focusMode === 'manual') focusTgt = P.focus;
  else if ((afT += dt) > 0.12) {
    afT = 0;
    let z = null;
    if (hover) z = hoverZ;
    else if (pinned) z = pinned.pts[2];
    else if (mouse.x >= 0) z = nearestDepth(mouse.x, mouse.y, 110);
    focusTgt = z !== null ? z : lastEventZ;
  }
  focusCur += (focusTgt - focusCur) * Math.min(1, dt * 2.6);
  if (P.focusMode === 'auto') P.focus = focusCur;
  // lerp grade + lamp colours
  const k = Math.min(1, dt * 2.2), tg = GRADES[P.grade];
  for (const key of ['liquid', 'fog', 'ambient', 'shadow', 'high', 'streakTint']) for (let i = 0; i < 3; i++) G[key][i] += (tg[key][i] - G[key][i]) * k;
  for (const key of ['sat', 'contrast', 'mono', 'hal', 'vig', 'flicker', 'grainAmt']) G[key] += (tg[key] - G[key]) * k;
  for (const l of lamps) {
    if (P.chroma) l.th += dt * 14;
    let dh = ((l.th - l.hue) % 360 + 540) % 360 - 180; l.hue += dh * k;
    l.sat += (l.ts - l.sat) * k; l.int += (l.ti - l.int) * k;
  }
  shake *= Math.pow(0.02, dt);
  torch.a += ((P.torch && torch.live && inWindow(torch.x, torch.y) ? 1 : 0) - torch.a) * Math.min(1, dt * 5);
  parX += ((mouse.x >= 0 ? mouse.x / W - .5 : 0) - parX) * Math.min(1, dt * 1.5);
  parY += ((mouse.y >= 0 ? .5 - mouse.y / H : 0) - parY) * Math.min(1, dt * 1.5);
}
function applyGrade(key) {
  P.grade = key; const g = GRADES[key];
  g.lamps.forEach(([h, s, i], n) => { if (lamps[n]) { lamps[n].th = h; lamps[n].ts = s; lamps[n].ti = i; } });
  P.species = g.species; syncInputs();
  document.querySelectorAll('[data-grade]').forEach(b => b.classList.toggle('on', b.dataset.grade === key));
  logEvent(`grade · <em>${g.name}</em>`);
}

// ---------------------------------------------------------------- render
function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
function pass(pr, dst, fn) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fbo : null);
  gl.viewport(0, 0, dst ? dst.w : RW, dst ? dst.h : RH);
  gl.useProgram(pr.p); fn(pr.u);
  gl.bindVertexArray(emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function drawSprites(B, pr, dst) {
  if (!B.n) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo); gl.viewport(0, 0, dst.w, dst.h);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  gl.useProgram(pr.p); gl.uniform2f(pr.u.uCss, W, H);
  gl.bindVertexArray(B.vao); gl.bindBuffer(gl.ARRAY_BUFFER, B.buf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, B.data, 0, B.n * 6);
  gl.drawArrays(gl.POINTS, 0, B.n);
  gl.disable(gl.BLEND); B.n = 0;
}
function blur(src, tmp, dst, k) {
  pass(prg.blur, tmp, u => { bindTex(0, src.tex); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uDir, k / src.w, 0); });
  pass(prg.blur, dst, u => { bindTex(0, tmp.tex); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uDir, 0, k / tmp.h); });
}
let snapRequested = false;
function render(time) {
  if (etch.dirty) drawEtch();
  const tex = [1 / RW, 1 / RH];
  // 1. nucleation seeds
  gl.bindFramebuffer(gl.FRAMEBUFFER, seed.fbo); gl.viewport(0, 0, RW, RH); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  drawSprites(BUB, prg.deposit, seed);
  // 2. ionisation glow: fade then add
  if (!P.paused) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, glowT.fbo); gl.viewport(0, 0, RW, RH);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
    gl.useProgram(prg.fade.p); gl.uniform1f(prg.fade.u.uK, P.trail); gl.bindVertexArray(emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }
  drawSprites(GLOW, prg.glow, glowT);
  // 3. evolve bubbles
  pass(prg.evolve, stB, u => {
    bindTex(0, stA.tex); bindTex(1, seed.tex);
    gl.uniform1i(u.uPrev, 0); gl.uniform1i(u.uSeed, 1); gl.uniform2f(u.uTexel, ...tex);
    gl.uniform1f(u.uAspect, W / H); gl.uniform1f(u.uGrowth, P.growth);
    gl.uniform1f(u.uFade, P.paused ? 1 : fadeRate()); gl.uniform1f(u.uSpread, P.spread * 0.92);
    gl.uniform1f(u.uDrift, P.paused ? 0 : P.drift); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uWipe, P.paused ? 0 : wipe);
  });
  [stA, stB] = [stB, stA];
  // 4. shade (MRT)
  const cocScale = P.aperture * 70 * simScale, maxCoc = Math.min(P.aperture * 34 * simScale, 30);
  pass(prg.shade, shadeT, u => {
    bindTex(0, stA.tex); bindTex(1, glowT.tex); gl.uniform1i(u.uState, 0); gl.uniform1i(u.uGlow, 1);
    gl.uniform2f(u.uTexel, ...tex); gl.uniform1f(u.uAspect, W / H); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uFlash, flash);
    gl.uniform1f(u.uFocus, focusCur); gl.uniform1f(u.uCoc, cocScale); gl.uniform1f(u.uMaxCoc, maxCoc);
    gl.uniform1f(u.uSpecies, P.species); gl.uniform1f(u.uCaustics, P.caustics); gl.uniform1f(u.uMotes, P.motes);
    gl.uniform3fv(u.uLiquid, G.liquid); gl.uniform3fv(u.uFog, G.fog); gl.uniform3fv(u.uAmbient, G.ambient);
    gl.uniform4fv(u['uLP[0]'], LP); gl.uniform3fv(u['uLC[0]'], LC); gl.uniform1i(u.uNL, nLights);
    gl.uniform2f(u.uPar, parX, parY); gl.uniform2f(u.uShake, gauss() * shake, gauss() * shake);
    bindTex(2, etch.tex); gl.uniform1i(u.uEtch, 2); gl.uniform2f(u.uEtchTexel, 1 / etch.cv.width, 1 / etch.cv.height);
    gl.uniform2f(u.uBindu, ...toP(bindu.x, bindu.y)); gl.uniform1f(u.uYantra, P.yantra); gl.uniform1f(u.uRings, P.rings); gl.uniform1f(u.uRes, resonance);
    gl.uniform4fv(u['uWave[0]'], WV); gl.uniform1i(u.uNW, waves.length);
  });
  bindTex(0, shadeT.tex); gl.generateMipmap(gl.TEXTURE_2D);
  // 5. depth of field + compose
  pass(prg.dof, hdr, u => {
    bindTex(0, shadeT.tex); bindTex(1, shadeT.tex2); gl.uniform1i(u.uBub, 0); gl.uniform1i(u.uVol, 1);
    gl.uniform2f(u.uTexel, ...tex); gl.uniform1f(u.uMaxCoc, maxCoc); gl.uniform1f(u.uTime, time);
  });
  // 6. bloom pyramid + anamorphic streak
  pass(prg.bright, b2a, u => { bindTex(0, hdr.tex); gl.uniform1i(u.uSrc, 0); gl.uniform1f(u.uThresh, 0.7); });
  blur(b2a, b2b, b2a, 1);
  blur(b2a, b4b, b4a, 1.5);
  blur(b4a, b8b, b8a, 1.5); blur(b8a, b8b, b8a, 2.5);
  pass(prg.blur, s4a, u => { bindTex(0, b4a.tex); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uDir, 2 / b4a.w, 0); });
  pass(prg.blur, s4b, u => { bindTex(0, s4a.tex); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uDir, 6 / b4a.w, 0); });
  pass(prg.blur, s4a, u => { bindTex(0, s4b.tex); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uDir, 18 / b4a.w, 0); });
  // 7. film
  pass(prg.film, null, u => {
    bindTex(0, hdr.tex); bindTex(1, b2a.tex); bindTex(2, b4a.tex); bindTex(3, b8a.tex); bindTex(4, s4a.tex);
    gl.uniform1i(u.uHdr, 0); gl.uniform1i(u.uB2, 1); gl.uniform1i(u.uB4, 2); gl.uniform1i(u.uB8, 3); gl.uniform1i(u.uStreak, 4);
    gl.uniform1f(u.uAspect, W / H); gl.uniform1f(u.uExposure, P.exposure * 1.25); gl.uniform1f(u.uBloom, P.bloom);
    gl.uniform1f(u.uStreakAmt, P.streak); gl.uniform1f(u.uDirt, P.dirt); gl.uniform1f(u.uGrain, G.grainAmt * P.grain);
    gl.uniform1f(u.uTime, time); gl.uniform1f(u.uBars, P.letterbox ? Math.max(0, .5 - (W / H) / 2.39 / 2) : 0);
    gl.uniform1f(u.uHal, G.hal); gl.uniform1f(u.uSat, G.sat); gl.uniform1f(u.uContrast, G.contrast); gl.uniform1f(u.uMono, G.mono);
    gl.uniform1f(u.uVig, G.vig); gl.uniform1f(u.uFlicker, G.flicker); gl.uniform1f(u.uDistort, P.distort); gl.uniform1f(u.uFlash, flash);
    gl.uniform3fv(u.uShadow, G.shadow); gl.uniform3fv(u.uHigh, G.high); gl.uniform3fv(u.uStreakTint, G.streakTint);
    gl.uniform2f(u.uRes, RW, RH);
  });
  if (snapRequested) { snapRequested = false; snapshot(); }
}
function snapshot() {
  const c = document.createElement('canvas'); c.width = RW; c.height = RH;
  c.getContext('2d').drawImage(glc, 0, 0);
  c.toBlob(b => {
    const box = $('#photo'), img = box.querySelector('img');
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(b); box.hidden = false;
  });
}
function clearAll() {
  for (const t of [stA, stB, glowT]) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
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
  { id: 'light', label: 'light', key: '2', icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>' },
  { id: 'seed', label: 'seed', key: '8', icon: '<path d="M12 12m-1 0a1 1 0 1 0 2 0a3 3 0 1 0-6 0a5 5 0 1 0 10 0a7.5 7.5 0 1 0-15 0"/>' },
  { id: 'field', label: 'field', key: '3', icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2" fill="currentColor"/>' },
  { id: 'target', label: 'target', key: '4', icon: '<circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>' },
  { id: 'source', label: 'source', key: '5', icon: '<circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 4a8 8 0 0 1 7 4M5 16a8 8 0 0 0 7 4M19 16l-2-1M5 8l2 1"/>' },
  { id: 'beam', label: 'beam', key: '6', icon: '<rect x="2" y="9" width="8" height="6" rx="1"/><path d="M10 12h12M18 9l3 3-3 3"/>' },
  { id: 'inspect', label: 'inspect', key: '7', icon: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l6 6"/>' },
];
let tool = 'shoot';
const pointers = new Map();
let hover = null, hoverZ = .5, pinned = null;
const mouse = { x: -1, y: -1 };

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
  mouse.x = x; mouse.y = y; torch.x = x; torch.y = y; torch.live = true;
  const st = { x0: x, y0: y, x, y, t0: performance.now(), mode: tool, neg: ev.button === 2 || ev.altKey, shift: ev.shiftKey };
  const he = hitEmitter(x, y), hl = hitList(lamps, x, y, 18);
  if (Math.hypot(x - bindu.x, y - bindu.y) < 11) { st.mode = 'bindu'; }
  else if (hl) { st.mode = 'lamp'; st.obj = hl; selLamp = hl; if (tool === 'light') buildToolOpts(); }
  else if (he) { st.mode = 'emitter-' + he.part; st.obj = he.e; }
  else if (tool === 'seed') { if (inWindow(x, y)) { addCone(x, y); st.mode = 'seeded'; } }
  else if (tool === 'light') {
    if (lamps.length < 6) { const l = { x, y, rx: x / W, ry: y / H, hue: rand() * 360, sat: .85, int: 0, th: 0, ts: .85, ti: 1.3, on: true }; l.th = l.hue; lamps.push(l); selLamp = l; st.mode = 'lamp'; st.obj = l; st.placed = true; buildToolOpts(); buildLampUI(); }
  } else if (tool === 'target' || tool === 'source') {
    const list = tool === 'target' ? targets : sources, o = hitList(list, x, y);
    if (o) { st.mode = 'move'; st.obj = o; st.list = list; }
    else if (inWindow(x, y)) { const n = tool === 'target' ? { x, y, r: 20 } : { x, y, acc: 0, type: P.sourceType, z: focusCur }; list.push(n); st.mode = 'placed'; st.obj = n; st.list = list; }
  } else if (tool === 'beam') {
    if (inWindow(x, y)) { const e = addEmitter(Math.atan2(y - H / 2, x - W / 2), 'mix', 900, 1.4, focusCur); e.x = x; e.y = y; e.rx = x / W; e.ry = y / H; st.mode = 'emitter-aim'; st.obj = e; }
  } else if (tool === 'inspect') pin(hover);
  pointers.set(ev.pointerId, st);
});
uic.addEventListener('pointermove', ev => {
  const x = ev.clientX, y = ev.clientY; mouse.x = x; mouse.y = y;
  if (ev.pointerType === 'mouse' || pointers.size) { torch.x = x; torch.y = y; torch.live = true; }
  const st = pointers.get(ev.pointerId);
  if (!st) { if (tool === 'inspect') updateHover(x, y); updateCursor(x, y); return; }
  const dx = x - st.x, dy = y - st.y; st.x = x; st.y = y;
  if (st.mode === 'bindu') { if (Math.hypot(x - st.x0, y - st.y0) > 4 && inWindow(x, y)) { bindu.x = x; bindu.y = y; bindu.rx = x / W; bindu.ry = y / H; etch.dirty = true; st.moved = true; } }
  else if (st.mode === 'lamp') { st.obj.x = x; st.obj.y = y; st.obj.rx = x / W; st.obj.ry = y / H; }
  else if (st.mode === 'emitter-body' || st.mode === 'move' || st.mode === 'placed') {
    if (Math.hypot(x - st.x0, y - st.y0) > 4 && st.mode === 'placed') st.mode = 'move';
    if (inWindow(x, y)) { st.obj.x = x; st.obj.y = y; if (st.obj.rx !== undefined) { st.obj.rx = x / W; st.obj.ry = y / H; } }
  } else if (st.mode === 'emitter-aim') st.obj.a = Math.atan2(y - st.obj.y, x - st.obj.x);
  else if (st.mode === 'field') field.paint(x, y, (st.neg ? -1 : 1) * P.brush * (0.004 * Math.hypot(dx, dy) + 0.01), P.brushR);
});
function endPointer(ev) {
  const st = pointers.get(ev.pointerId); if (!st) return;
  pointers.delete(ev.pointerId);
  if (ev.pointerType !== 'mouse' && !pointers.size) setTimeout(() => { if (!pointers.size) torch.live = false; }, 900);
  const d = Math.hypot(st.x - st.x0, st.y - st.y0);
  if (st.mode === 'bindu') { if (!st.moved) addCone(bindu.x, bindu.y); }
  else if (st.mode === 'shoot') {
    if (!inWindow(st.x0, st.y0)) { /* outside the glass */ }
    else if (d < 8) spark(st.x0, st.y0);
    else {
      const p = momentumFromDrag(d), n = st.shift ? 8 : P.burst;
      for (let i = 0; i < n; i++) {
        const sp = P.shootSpecies === 'mix' ? pick(BEAM_MIX) : P.shootSpecies, a = Math.atan2(st.y - st.y0, st.x - st.x0) + (n > 1 ? gauss() * .03 : 0);
        const o = spawn(sp, st.x0, st.y0, Math.cos(a), Math.sin(a), p * (n > 1 ? 1 + gauss() * .05 : 1), null, focusCur, gauss() * .05);
        if (o && n === 1) logEvent(`fired <em>${SP[sp].sym}</em> ${fmtP(p)}`);
      }
      addFlash(st.x0, st.y0, hsvLin(P.torchHue, .5, 1), 1.2, .3, 160); lastEventZ = focusCur;
    }
  } else if (st.mode === 'lamp' && tool === 'light' && !st.placed && d < 4) { lamps.splice(lamps.indexOf(st.obj), 1); selLamp = lamps[0] || null; buildToolOpts(); buildLampUI(); }
  else if (st.mode === 'move' && !inWindow(st.x, st.y)) st.list.splice(st.list.indexOf(st.obj), 1);
  else if (st.mode === 'emitter-body' && d < 4 && performance.now() - st.t0 < 300) fireEmitter(st.obj, 6);
  else if ((tool === 'target' || tool === 'source') && st.mode === 'move' && d < 4) st.list.splice(st.list.indexOf(st.obj), 1);
  if (st.mode.startsWith('emitter')) buildEmitterUI();
}
uic.addEventListener('pointerup', endPointer);
uic.addEventListener('pointercancel', endPointer);
uic.addEventListener('pointerleave', () => { if (!pointers.size) { hover = null; torch.live = false; mouse.x = mouse.y = -1; $('#tip').classList.remove('on'); } });
uic.addEventListener('dblclick', ev => {
  const he = hitEmitter(ev.clientX, ev.clientY); if (!he) return;
  const i = SHOOTABLE.indexOf(he.e.sp); he.e.sp = SHOOTABLE[(i + 1) % SHOOTABLE.length]; buildEmitterUI();
});
uic.addEventListener('wheel', ev => {
  const x = ev.clientX, y = ev.clientY;
  const hl = hitList(lamps, x, y, 22);
  if (hl) { ev.preventDefault(); hl.th += ev.deltaY * 0.15; selLamp = hl; if (tool === 'light') buildToolOpts(); return; }
  const he = hitEmitter(x, y);
  if (he) { ev.preventDefault(); he.e.p = clamp(he.e.p * Math.exp(-ev.deltaY * 0.0015), 20, 8000); buildEmitterUI(); return; }
  if (tool === 'field') { ev.preventDefault(); P.brushR = clamp(P.brushR * Math.exp(-ev.deltaY * 0.001), 30, 300); buildToolOpts(); return; }
  if (tool === 'light' || ev.altKey) { ev.preventDefault(); P.torchHue = (P.torchHue + ev.deltaY * 0.15 + 360) % 360; syncInputs(); return; }
  // otherwise: wheel pulls focus by hand
  ev.preventDefault(); P.focusMode = 'manual'; P.focus = clamp(P.focus + ev.deltaY * 0.0006, 0, 1); syncInputs();
}, { passive: false });
function updateCursor(x, y) {
  const he = hitEmitter(x, y);
  uic.style.cursor = Math.hypot(x - bindu.x, y - bindu.y) < 11 ? 'grab' : hitList(lamps, x, y, 18) ? 'grab' : he ? (he.part === 'aim' ? 'grab' : 'move')
    : (tool === 'target' && hitList(targets, x, y)) || (tool === 'source' && hitList(sources, x, y)) ? 'move'
    : tool === 'inspect' ? (hover ? 'pointer' : 'default') : 'crosshair';
}
function updateHover(x, y) {
  let best = null, bd = 12 * 12, bz = .5;
  for (const t of tracks) {
    if (SP[t.sp].q === 0 && !P.recon) continue;
    const p = t.pts;
    for (let i = 0; i < p.length - 3; i += 3) {
      const ax = p[i], ay = p[i + 1], vx = p[i + 3] - ax, vy = p[i + 4] - ay, l2 = vx * vx + vy * vy || 1;
      const k = clamp(((x - ax) * vx + (y - ay) * vy) / l2, 0, 1);
      const ex = ax + vx * k - x, ey = ay + vy * k - y, d2 = ex * ex + ey * ey;
      if (d2 < bd) { bd = d2; best = t; bz = p[i + 2]; }
    }
  }
  hover = best; hoverZ = bz;
  const tip = $('#tip');
  if (best) {
    const s = SP[best.sp];
    tip.innerHTML = `<b>${s.sym}</b> ${s.name}<br>p₀ ${fmtP(best.p0)} · q ${s.q > 0 ? '+' : ''}${s.q}<br>depth ${(bz * 100).toFixed(0)} cm · ${best.alive ? 'in flight' : best.end}`;
    tip.style.left = Math.min(x + 16, W - 200) + 'px'; tip.style.top = (y + 14) + 'px'; tip.classList.add('on');
  } else tip.classList.remove('on');
}
function pin(t) { pinned = t; showInspector(); }
function showInspector() {
  const el = $('#inspector');
  if (!pinned) { el.classList.remove('on'); return; }
  const t = pinned, s = SP[t.sp], B = field.at(t.pts[0], t.pts[1]);
  const radius = s.q ? (t.p0 / 1000) / (0.3 * Math.abs(s.q) * Math.max(Math.abs(B), 0.01)) : Infinity;
  const kids = t.kids.map(k => `<div><a data-id="${k.id}">${SP[k.sp].sym}</a> ${fmtP(k.p0)}${k.kids.length ? ` <span style="opacity:.5">+${k.kids.length}</span>` : ''}</div>`).join('');
  el.innerHTML = `<h3><span>${s.sym} <small style="font:11px var(--mono);color:var(--muted)">${s.name} #${t.id}</small></span><button id="unpin" aria-label="Close">×</button></h3>
    <dl><dt>mass</dt><dd>${fmtE(s.m)}/c²</dd><dt>charge</dt><dd>${s.q > 0 ? '+' : ''}${s.q} e</dd>
    <dt>p₀</dt><dd>${fmtP(t.p0)}</dd><dt>r₀ @ ${B.toFixed(2)} T</dt><dd>${isFinite(radius) ? radius.toFixed(2) + ' m' : '∞'}</dd>
    <dt>depth</dt><dd>${(t.pts[2] * 100).toFixed(0)} cm</dd><dt>path</dt><dd>${(t.len / S * 100).toFixed(1)} cm</dd><dt>fate</dt><dd>${t.alive ? 'in flight' : t.end}</dd></dl>
    <div class="tree">${t.parent ? `parent: <a data-id="${t.parent.id}">${SP[t.parent.sp].sym}</a><br>` : 'primary<br>'}${kids ? 'daughters:' + kids : ''}</div>`;
  el.classList.add('on');
  $('#unpin').onclick = () => pin(null);
  el.querySelectorAll('a[data-id]').forEach(a => a.onclick = () => { const f = tracks.find(x => x.id === +a.dataset.id); if (f) pin(f); });
}
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
const C = { warm: '#ffc27a', text: '#e6eef0', muted: '#8a9aa0' };
function poly(pts, stride = 2) { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = stride; i < pts.length; i += stride) ctx.lineTo(pts[i], pts[i + 1]); }
const trackColor = t => { const s = SP[t.sp]; return s.q === 0 ? 'rgba(255,255,255,.6)' : `hsl(${(s.hue || 0) * 360} 85% 68%)`; };
function drawOverlay(time) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = '10px "JetBrains Mono", monospace';
  if (P.showField || tool === 'field') {
    const c = field.cell * 2;
    for (let y = c / 2; y < H; y += c) for (let x = c / 2; x < W; x += c) {
      if (!inWindow(x, y)) continue;
      const b = field.at(x, y), r = clamp(Math.abs(b) * 4, 1, 10), al = clamp(0.1 + Math.abs(b) * 0.1, 0, .45);
      ctx.strokeStyle = ctx.fillStyle = b >= 0 ? `rgba(255,194,122,${al})` : `rgba(140,220,255,${al})`;
      ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.stroke();
      if (b >= 0) { ctx.beginPath(); ctx.arc(x, y, 1.3, 0, 6.283); ctx.fill(); }
      else { const k = r * .6; ctx.beginPath(); ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k); ctx.stroke(); }
    }
    if (tool === 'field' && mouse.x >= 0) { ctx.strokeStyle = 'rgba(230,238,240,.3)'; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.arc(mouse.x, mouse.y, P.brushR, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); }
  }
  if (P.recon) {
    ctx.lineWidth = 1;
    for (const t of tracks) {
      if (t.pts.length < 6) continue;
      const neutral = SP[t.sp].q === 0;
      ctx.strokeStyle = trackColor(t); ctx.globalAlpha = neutral ? .7 : .5; ctx.setLineDash(neutral ? [3, 4] : []);
      poly(t.pts, 3); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.fillStyle = C.warm;
    for (const t of tracks) if (t.kids.length && !t.alive) { const n = t.pts.length; ctx.beginPath(); ctx.arc(t.pts[n - 3], t.pts[n - 2], 2.5, 0, 6.283); ctx.fill(); }
    for (const o of particles) if (o.s.q === 0) { const p = o.track.pts; ctx.strokeStyle = trackColor(o.track); ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(p[p.length - 3], p[p.length - 2]); ctx.lineTo(o.x, o.y); ctx.stroke(); ctx.setLineDash([]); }
  }
  const hl = (t, w, al) => {
    if (!t || t.pts.length < 3) return;
    ctx.lineWidth = w; ctx.strokeStyle = trackColor(t); ctx.globalAlpha = al; ctx.setLineDash(SP[t.sp].q === 0 ? [3, 4] : []);
    poly(t.pts, 3); const live = particles.find(o => o.track === t); if (live) ctx.lineTo(live.x, live.y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  };
  if (pinned) {
    const walk = (t, d) => { hl(t, d ? 1.2 : 2.2, d ? .5 : .9); if (d < 4) t.kids.forEach(k => walk(k, d + 1)); };
    if (pinned.parent) hl(pinned.parent, 1, .3);
    walk(pinned, 0);
    ctx.fillStyle = C.text; ctx.beginPath(); ctx.arc(pinned.pts[0], pinned.pts[1], 3, 0, 6.283); ctx.fill();
  }
  if (hover && hover !== pinned) hl(hover, 1.8, .75);
  for (const t of targets) {
    ctx.strokeStyle = 'rgba(255,194,122,.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, 6.283); ctx.stroke();
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r * .35 + Math.sin(time * 3) * 1.5, 0, 6.283); ctx.stroke();
    ctx.beginPath(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; ctx.moveTo(t.x + Math.cos(a) * (t.r + 3), t.y + Math.sin(a) * (t.r + 3)); ctx.lineTo(t.x + Math.cos(a) * (t.r + 9), t.y + Math.sin(a) * (t.r + 9)); } ctx.stroke();
  }
  for (const s of sources) {
    ctx.fillStyle = 'rgba(255,120,150,.8)'; ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, 6.283); ctx.fill();
    for (let k = 0; k < 3; k++) { const a = k * 2.094 + time * .6; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.arc(s.x, s.y, 10, a, a + 0.75); ctx.closePath(); ctx.globalAlpha = .35; ctx.fill(); ctx.globalAlpha = 1; }
  }
  for (const e of emitters) {
    const ca = Math.cos(e.a), sa = Math.sin(e.a);
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.a);
    ctx.fillStyle = 'rgba(8,12,14,.75)'; ctx.strokeStyle = 'rgba(230,238,240,.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-22, -7, 30, 14, 2) : ctx.rect(-22, -7, 30, 14); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, -4); ctx.lineTo(13, 0); ctx.lineTo(8, 4); ctx.stroke();
    ctx.setLineDash([2, 4]); ctx.globalAlpha = .4; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(40, 0); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.restore();
    ctx.beginPath(); ctx.arc(e.x + ca * 46, e.y + sa * 46, 4.5, 0, 6.283); ctx.strokeStyle = 'rgba(230,238,240,.55)'; ctx.stroke();
    ctx.fillStyle = C.muted; ctx.textAlign = 'center';
    ctx.fillText(`${symOf(e.sp)} ${fmtP(e.p)}`, clamp(e.x - ca * 4, 48, W - 48), clamp(e.y - sa * 4 + (sa > 0.3 ? -16 : 22), 12, H - 6));
  }
  // lamps: coloured handles
  for (const l of lamps) {
    const col = cssHue(l.hue, l.sat, .62), sel = l === selLamp && tool === 'light';
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, 26);
    g.addColorStop(0, cssHue(l.hue, l.sat, .7).replace(')', ' / .55)')); g.addColorStop(1, cssHue(l.hue, l.sat, .5).replace(')', ' / 0)'));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(l.x, l.y, 26, 0, 6.283); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(l.x, l.y, 5, 0, 6.283); ctx.fill();
    ctx.strokeStyle = sel ? '#fff' : 'rgba(255,255,255,.45)'; ctx.lineWidth = sel ? 1.5 : 1;
    ctx.beginPath(); ctx.arc(l.x, l.y, 10, 0, 6.283); ctx.stroke();
    if (sel || tool === 'light') { ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.fillText(`${Math.round(((l.hue % 360) + 360) % 360)}°`, clamp(l.x, 30, W - 30), clamp(l.y + 24, 12, H - 6)); }
  }
  for (const st of pointers.values()) {
    if (st.mode !== 'shoot') continue;
    const d = Math.hypot(st.x - st.x0, st.y - st.y0); if (d < 8) continue;
    const p = momentumFromDrag(d), a = Math.atan2(st.y - st.y0, st.x - st.x0), sp = P.shootSpecies === 'mix' ? 'pi-' : P.shootSpecies;
    const pts = predict(st.x0, st.y0, a, p, sp);
    ctx.strokeStyle = C.warm; ctx.lineWidth = 1.2; ctx.setLineDash([5, 5]); ctx.lineDashOffset = -time * 30;
    poly(pts); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = .3; ctx.beginPath(); ctx.moveTo(st.x0, st.y0); ctx.lineTo(st.x, st.y); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(st.x0, st.y0, 3.5, 0, 6.283); ctx.fillStyle = C.warm; ctx.fill();
    const B = field.at(st.x0, st.y0), r = SP[sp].q ? (p / 1000) / (0.3 * Math.abs(SP[sp].q) * Math.max(Math.abs(B), .01)) : Infinity;
    ctx.textAlign = 'left'; ctx.fillStyle = C.text;
    ctx.fillText(`${symOf(P.shootSpecies)}  ${fmtP(p)}  r=${isFinite(r) ? r.toFixed(2) + 'm' : '∞'}`, st.x + 12, st.y - 10);
  }
  // focus reticle: a slim depth scale on the right edge of the glass
  {
    const x = W - 22, y0 = H * .3, y1 = H * .7, yy = y0 + (y1 - y0) * focusCur;
    ctx.strokeStyle = 'rgba(230,238,240,.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); for (let i = 0; i <= 10; i++) { const y = y0 + (y1 - y0) * i / 10; ctx.moveTo(x - (i % 5 ? 3 : 6), y); ctx.lineTo(x, y); } ctx.stroke();
    ctx.strokeStyle = C.warm; ctx.beginPath(); ctx.moveTo(x - 9, yy); ctx.lineTo(x + 3, yy); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.fillText(`${(focusCur * 100).toFixed(0)} cm`, x - 12, yy + 3);
    ctx.fillText(P.focusMode === 'auto' ? 'AF' : 'MF', x + 4, y0 - 8);
  }
  // bindu: barely there unless you look for it
  {
    const near = mouse.x >= 0 && Math.hypot(mouse.x - bindu.x, mouse.y - bindu.y) < 40, show = near || tool === 'seed';
    ctx.globalAlpha = show ? .7 : .22 + resonance * .5;
    ctx.strokeStyle = C.warm; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(bindu.x, bindu.y, 6 + resonance * 4, 0, 6.283); ctx.stroke();
    ctx.fillStyle = C.warm; ctx.beginPath(); ctx.arc(bindu.x, bindu.y, 1.4, 0, 6.283); ctx.fill();
    if (show) { ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.fillText(`bindu · ${tree.age} rings`, bindu.x, bindu.y + 22); }
    ctx.globalAlpha = 1;
  }
  if (P.recon) {   // seed-head parastichies: the 8 and 13 spiral families
    ctx.lineWidth = .8;
    for (const c of cones) {
      for (const [k, col] of [[8, 'rgba(255,194,122,.45)'], [13, 'rgba(140,220,255,.4)']]) {
        ctx.strokeStyle = col;
        for (let s0 = 0; s0 < k; s0++) { ctx.beginPath(); let first = true; for (let n = s0; n * 2 + 1 < c.pts.length; n += k) { const x = c.pts[n * 2], y = c.pts[n * 2 + 1]; first ? ctx.moveTo(x, y) : ctx.lineTo(x, y); first = false; } ctx.stroke(); }
      }
    }
  }
  if (P.pulsed) {
    const x = W - 34, y = H - 34;
    ctx.strokeStyle = 'rgba(230,238,240,.2)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 14, 0, 6.283); ctx.stroke();
    ctx.strokeStyle = C.warm; ctx.beginPath(); ctx.arc(x, y, 14, -Math.PI / 2, -Math.PI / 2 + cyclePhase * 6.283); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.fillText(sens > 0 ? 'EXPANSION' : wipe ? 'RECOMPRESS' : 'GROWTH', x - 22, y + 3);
  }
}

// ---------------------------------------------------------------- UI construction
const inputs = [];   // [key, input, output, fmt] for re-sync after programmatic changes
function slider(parent, key, label, min, max, step, fmt = v => v.toFixed(2), onChange) {
  const row = document.createElement('label'); row.className = 'row';
  row.innerHTML = `<span>${label}</span><output>${fmt(P[key])}</output><input type="range" id="in-${key}" min="${min}" max="${max}" step="${step}" value="${P[key]}">`;
  const inp = row.querySelector('input'), out = row.querySelector('output');
  inp.oninput = () => { P[key] = +inp.value; out.textContent = fmt(P[key]); onChange && onChange(); };
  inputs.push([key, inp, out, fmt]);
  parent.appendChild(row); return inp;
}
function toggle(parent, key, label, onChange) {
  const row = document.createElement('label'); row.className = 'chk';
  row.innerHTML = `<span>${label}</span><span class="switch"><input type="checkbox" id="tg-${key}" ${P[key] ? 'checked' : ''}><i></i></span>`;
  const inp = row.querySelector('input'); inp.onchange = () => { P[key] = inp.checked; onChange && onChange(); };
  inputs.push([key, inp]);
  parent.appendChild(row); return row;
}
function seg(parent, label, items, cur, onPick, attr) {
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = `<span>${label}</span><output></output><div class="seg">${items.map(([v, t]) => `<button data-${attr}="${v}" class="${v === cur ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  row.querySelectorAll('button').forEach(b => b.onclick = () => { onPick(b.dataset[attr]); row.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
  parent.appendChild(row); return row;
}
function syncInputs() {
  for (const [key, inp, out, fmt] of inputs) {
    if (!inp.isConnected) continue;
    if (inp.type === 'checkbox') inp.checked = !!P[key];
    else { inp.value = P[key]; if (out) out.textContent = fmt(P[key]); }
  }
  document.querySelectorAll('[data-fm]').forEach(b => b.classList.toggle('on', b.dataset.fm === P.focusMode));
}
function heading(parent, text, btn) {
  const h = document.createElement('h2'); h.textContent = text;
  if (btn) { const b = document.createElement('button'); b.textContent = btn[0]; b.onclick = btn[1]; h.appendChild(b); }
  parent.appendChild(h);
}
const panel = $('#panel');
function buildPanel() {
  panel.innerHTML = ''; inputs.length = 0;
  heading(panel, 'Light & colour');
  seg(panel, 'Grade', GRADE_KEYS.map(k => [k, GRADES[k].name.split(' ')[0]]), P.grade, applyGrade, 'grade');
  const lw = document.createElement('div'); lw.id = 'lamps'; panel.appendChild(lw);
  toggles.chroma = toggle(panel, 'chroma', 'Chroma drift (lamps cycle hue)');
  toggles.torch = toggle(panel, 'torch', 'Cursor torch');
  slider(panel, 'torchHue', 'Torch hue', 0, 360, 1, v => Math.round(v) + '°');
  slider(panel, 'glow', 'Ionisation glow', 0, 3, 0.01, v => '×' + v.toFixed(2));
  slider(panel, 'trail', 'Glow trail', 0.6, 0.985, 0.001, v => v.toFixed(3));
  slider(panel, 'species', 'Tint bubbles by particle', 0, 1, 0.01);
  heading(panel, 'Sacred geometry', ['bloom', () => addCone(bindu.x, bindu.y)]);
  slider(panel, 'yantra', 'Śrī Yantra etching', 0, 3, 0.01, v => v < .01 ? 'off' : '×' + v.toFixed(2));
  slider(panel, 'rings', 'Tree rings', 0, 3, 0.01, v => v < .01 ? 'off' : '×' + v.toFixed(2));
  slider(panel, 'ringRate', 'Ring growth', 0, 4, 0.01, v => '×' + v.toFixed(2));
  slider(panel, 'waves', 'Pressure waves', 0, 2, 0.01, v => v < .01 ? 'off' : '×' + v.toFixed(2));
  { const b = document.createElement('div'); b.className = 'btnrow'; b.style.margin = '0 0 6px';
    b.innerHTML = `<button class="btn" id="bFell">fell the tree</button><button class="btn" id="bCentre">centre the bindu</button>`; panel.appendChild(b);
    b.querySelector('#bFell').onclick = () => { logEvent(`tree felled at <em>${tree.age}</em> rings`); seedTree(); };
    b.querySelector('#bCentre').onclick = () => { bindu.rx = bindu.ry = .5; bindu.x = W / 2; bindu.y = H / 2; etch.dirty = true; }; }
  heading(panel, 'Camera');
  const fm = seg(panel, 'Focus', [['auto', 'autofocus'], ['manual', 'manual']], P.focusMode, v => { P.focusMode = v; }, 'fm');
  void fm;
  slider(panel, 'focus', 'Focus distance', 0, 1, 0.001, v => (v * 100).toFixed(0) + ' cm', () => { P.focusMode = 'manual'; syncInputs(); });
  slider(panel, 'aperture', 'Aperture', 0, 1, 0.01, v => v < .02 ? 'pinhole' : 'T' + (1.2 / Math.max(v, .05)).toFixed(1));
  slider(panel, 'exposure', 'Exposure', 0.2, 3, 0.01, v => (Math.log2(v) >= 0 ? '+' : '') + Math.log2(v).toFixed(1) + ' EV');
  slider(panel, 'bloom', 'Bloom', 0, 3, 0.01);
  slider(panel, 'streak', 'Anamorphic streak', 0, 3, 0.01);
  slider(panel, 'dirt', 'Lens dirt', 0, 3, 0.01);
  slider(panel, 'distort', 'Lens distortion', 0, 2, 0.01);
  slider(panel, 'grain', 'Film grain', 0, 3, 0.01, v => '×' + v.toFixed(2));
  toggles.letterbox = toggle(panel, 'letterbox', 'Scope letterbox 2.39:1');
  heading(panel, 'Chamber', ['clear', clearAll]);
  slider(panel, 'B', 'Magnetic field B', -3, 3, 0.01, v => v.toFixed(2) + ' T', () => $('#bread').textContent = P.B.toFixed(2) + ' T');
  slider(panel, 'density', 'Liquid density / dE/dx', 0.2, 3, 0.01, v => '×' + v.toFixed(2));
  slider(panel, 'speed', 'Time scale', 0.05, 3, 0.01, v => '×' + v.toFixed(2));
  slider(panel, 'caustics', 'Caustics', 0, 3, 0.01);
  slider(panel, 'motes', 'Suspended motes', 0, 3, 0.01);
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
  toggles.pulsed = toggle(panel, 'pulsed', 'Pulsed expansion cycle  X');
  toggles.recon = toggle(panel, 'recon', 'Reconstruction overlay  R');
  toggles.showField = toggle(panel, 'showField', 'Field map overlay  F');
  toggles.audio = toggle(panel, 'audio', 'Sonify events', () => { if (P.audio) { audio.init(); audio.ctx && audio.ctx.resume(); } });
  toggles.paused = toggle(panel, 'paused', 'Pause  ␣');
  heading(panel, 'Keys');
  const k = document.createElement('p'); k.className = 'keys';
  k.innerHTML = `<b>1–8</b> layers · <b>G</b> next grade · <b>␣</b> pause · <b>C</b> clear<br><b>wheel</b> pull focus · <b>A</b> autofocus · <b>L</b> letterbox<br><b>wheel on lamp</b> hue · <b>alt+wheel</b> torch hue<br><b>R</b> reconstruction · <b>F</b> field · <b>X</b> pulse · <b>B</b> burst<br><b>P</b> photograph · <b>H</b> hide UI · <b>Esc</b> unpin<br><b>tap the bindu</b> bloom a seed head · <b>drag it</b> move the centre`;
  panel.appendChild(k);
  const b = document.createElement('div'); b.className = 'btnrow'; b.style.marginTop = '10px';
  b.innerHTML = `<button class="btn" id="bPhoto">photograph</button><button class="btn" id="bBurst">burst</button><button class="btn" id="bReset">reset scene</button>`;
  panel.appendChild(b);
  $('#bPhoto').onclick = () => snapRequested = true;
  $('#bBurst').onclick = () => emitters.forEach(e => fireEmitter(e, 8));
  $('#bReset').onclick = () => defaultScene(true);
  buildEmitterUI(); buildLampUI();
}
const toggles = {};
function buildLampUI() {
  const lw = $('#lamps'); if (!lw) return; lw.innerHTML = '';
  lamps.forEach((l, idx) => {
    const box = document.createElement('div'); box.className = 'emitter lamp';
    box.innerHTML = `<header><span><i class="sw"></i>LAMP ${idx + 1}</span><button aria-label="Remove lamp">×</button></header>
      <label class="row"><span>Hue</span><output>${Math.round(l.th)}°</output><input type="range" id="lamp${idx}-h" class="hue" min="0" max="360" step="1" value="${((l.th % 360) + 360) % 360}"></label>
      <label class="row"><span>Intensity</span><output>${l.ti.toFixed(2)}</output><input type="range" id="lamp${idx}-i" min="0" max="4" step="0.01" value="${l.ti}"></label>`;
    const sw = box.querySelector('.sw'); sw.style.background = cssHue(l.th, l.ts, .6);
    box.querySelector('header button').onclick = () => { lamps.splice(lamps.indexOf(l), 1); buildLampUI(); };
    const [h, i] = box.querySelectorAll('input'), [ho, io] = box.querySelectorAll('output');
    h.oninput = () => { l.th = +h.value; ho.textContent = h.value + '°'; sw.style.background = cssHue(l.th, l.ts, .6); };
    i.oninput = () => { l.ti = +i.value; io.textContent = l.ti.toFixed(2); };
    lw.appendChild(box);
  });
  const add = document.createElement('div'); add.className = 'btnrow'; add.style.margin = '0 0 10px';
  add.innerHTML = `<button class="btn">+ lamp</button>`;
  add.firstChild.onclick = () => { if (lamps.length < 6) { addLamp(rand() * 6.283, rand() * 360); buildLampUI(); } };
  lw.appendChild(add);
}
function buildEmitterUI() {
  const ew = $('#emitters'); if (!ew) return; ew.innerHTML = '';
  emitters.forEach((e, idx) => {
    const box = document.createElement('div'); box.className = 'emitter';
    box.innerHTML = `<header><span>BEAM ${idx + 1}</span><button aria-label="Remove beam">×</button></header>
      <label class="row"><span>Species</span><output></output><select id="em${idx}-sp">${SHOOTABLE.map(s => `<option value="${s}" ${s === e.sp ? 'selected' : ''}>${symOf(s)}${s === 'mix' ? ' (secondary beam)' : ''}</option>`).join('')}</select></label>
      <label class="row"><span>Momentum</span><output>${fmtP(e.p)}</output><input type="range" id="em${idx}-p" min="2.7" max="9" step="0.01" value="${Math.log(e.p)}"></label>
      <label class="row"><span>Rate</span><output>${e.rate.toFixed(1)}/s</output><input type="range" id="em${idx}-r" min="0" max="12" step="0.1" value="${e.rate}"></label>
      <label class="row"><span>Depth</span><output>${(e.z * 100).toFixed(0)} cm</output><input type="range" id="em${idx}-z" min="0.02" max="0.98" step="0.01" value="${e.z}"></label>`;
    box.querySelector('header button').onclick = () => { emitters.splice(emitters.indexOf(e), 1); buildEmitterUI(); };
    box.querySelector('select').onchange = ev => e.sp = ev.target.value;
    const [mp, rt, dz] = box.querySelectorAll('input'), [, mo, ro, zo] = box.querySelectorAll('output');
    mp.oninput = () => { e.p = Math.exp(+mp.value); mo.textContent = fmtP(e.p); };
    rt.oninput = () => { e.rate = +rt.value; ro.textContent = e.rate.toFixed(1) + '/s'; };
    dz.oninput = () => { e.z = +dz.value; zo.textContent = (e.z * 100).toFixed(0) + ' cm'; };
    ew.appendChild(box);
  });
}
function buildToolOpts() {
  const o = $('#toolopts'); o.innerHTML = '';
  const add = html => { const s = document.createElement('label'); s.innerHTML = html; o.appendChild(s); return s; };
  if (tool === 'shoot') {
    const s = add(`particle <select id="opt-sp">${SHOOTABLE.map(k => `<option value="${k}" ${k === P.shootSpecies ? 'selected' : ''}>${symOf(k)}</option>`).join('')}</select>`);
    s.querySelector('select').onchange = e => P.shootSpecies = e.target.value;
    const b = add(`burst <input type="range" id="opt-burst" min="1" max="12" step="1" value="${P.burst}"> <span>${P.burst}</span>`);
    b.querySelector('input').oninput = e => { P.burst = +e.target.value; b.querySelector('span').textContent = P.burst; };
    add(`<span class="desc">drag to aim · length = momentum · tap = spark · fires at focus depth</span>`);
  } else if (tool === 'light') {
    if (selLamp) {
      const l = selLamp;
      const h = add(`hue <input type="range" id="opt-lh" class="hue" min="0" max="360" step="1" value="${((l.th % 360) + 360) % 360}">`);
      h.querySelector('input').oninput = e => { l.th = +e.target.value; buildLampUI(); };
      const s = add(`saturation <input type="range" id="opt-ls" min="0" max="1" step="0.01" value="${l.ts}">`);
      s.querySelector('input').oninput = e => l.ts = +e.target.value;
      const i = add(`intensity <input type="range" id="opt-li" min="0" max="4" step="0.01" value="${l.ti}">`);
      i.querySelector('input').oninput = e => { l.ti = +e.target.value; buildLampUI(); };
    }
    add(`<span class="desc">click to add a lamp · drag to move · click a lamp to remove · wheel on lamp = hue</span>`);
  } else if (tool === 'field') {
    const a = add(`strength <input type="range" id="opt-bs" min="0.1" max="3" step="0.01" value="${P.brush}">`); a.querySelector('input').oninput = e => P.brush = +e.target.value;
    const r = add(`radius <input type="range" id="opt-br" min="30" max="300" step="1" value="${P.brushR}">`); r.querySelector('input').oninput = e => P.brushR = +e.target.value;
    const c = document.createElement('button'); c.className = 'btn'; c.textContent = 'flatten'; c.onclick = () => field.clear(); o.appendChild(c);
    add(`<span class="desc">paint ⊙ · right-drag / alt ⊗</span>`);
  } else if (tool === 'target') {
    const a = add(`interaction <input type="range" id="opt-tp" min="0" max="1" step="0.01" value="${P.targetProb}">`); a.querySelector('input').oninput = e => P.targetProb = +e.target.value;
    add(`<span class="desc">click to place nucleus · drag to move · click again to remove</span>`);
  } else if (tool === 'source') {
    const s = add(`isotope <select id="opt-iso"><option value="mixed">α + β mixed</option><option value="beta">β emitter</option><option value="alpha">α emitter</option></select>`);
    s.querySelector('select').value = P.sourceType; s.querySelector('select').onchange = e => P.sourceType = e.target.value;
    const r = add(`activity <input type="range" id="opt-act" min="0.5" max="30" step="0.5" value="${P.sourceRate}">`); r.querySelector('input').oninput = e => P.sourceRate = +e.target.value;
    add(`<span class="desc">sources sit at the current focus depth</span>`);
  } else if (tool === 'seed') {
    const n = add(`florets <select id="opt-fl">${[55, 89, 144, 233, 377].map(v => `<option ${v === P.florets ? 'selected' : ''}>${v}</option>`).join('')}</select>`);
    n.querySelector('select').onchange = e => P.florets = +e.target.value;
    const sp = add(`spacing <input type="range" id="opt-fs" min="3" max="10" step="0.1" value="${P.floretSpacing}">`); sp.querySelector('input').oninput = e => P.floretSpacing = +e.target.value;
    const t = add(`Fibonacci electrons <span class="switch"><input type="checkbox" id="opt-fe" ${P.fibElectrons ? 'checked' : ''}><i></i></span>`);
    t.querySelector('input').onchange = e => P.fibElectrons = e.target.checked;
    add(`<span class="desc">click to grow a seed head · drag the bindu to move the yantra and tree</span>`);
  } else if (tool === 'beam') {
    add(`<span class="desc">click inside to place a beam port, drag to aim · panel ▸ Beam line for species, rate, depth</span>`);
  } else if (tool === 'inspect') {
    add(`<span class="desc">hover a track (focus follows) · click to pin and walk its decay tree</span>`);
    const t = document.createElement('label'); t.innerHTML = `show neutrals <span class="switch"><input type="checkbox" id="opt-neu" ${P.recon ? 'checked' : ''}><i></i></span>`;
    t.querySelector('input').onchange = e => { P.recon = e.target.checked; syncInputs(); }; o.appendChild(t);
  }
}
function buildTools() {
  $('#tools').innerHTML = TOOLS.map(t => `<button data-id="${t.id}" title="${t.label} (${t.key})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg><span class="lbl">${t.label}</span></button>`).join('');
  document.querySelectorAll('#tools button').forEach(b => b.onclick = () => setTool(b.dataset.id));
}
$('#paneltoggle').onclick = () => panel.classList.toggle('closed');
$('#photo').onclick = () => $('#photo').hidden = true;
if (innerWidth < 720) panel.classList.add('closed');

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  const t = TOOLS.find(t => t.key === k); if (t) { setTool(t.id); return; }
  if (k === ' ') { e.preventDefault(); P.paused = !P.paused; }
  else if (k === 'c') clearAll();
  else if (k === 'g') applyGrade(GRADE_KEYS[(GRADE_KEYS.indexOf(P.grade) + 1) % GRADE_KEYS.length]);
  else if (k === 'a') P.focusMode = 'auto';
  else if (k === 'l') P.letterbox = !P.letterbox;
  else if (k === 'r') { P.recon = !P.recon; if (tool === 'inspect') buildToolOpts(); }
  else if (k === 'f') P.showField = !P.showField;
  else if (k === 'x') P.pulsed = !P.pulsed;
  else if (k === 'h') document.body.classList.toggle('hideui');
  else if (k === 'p') snapRequested = true;
  else if (k === 'b') emitters.forEach(em => fireEmitter(em, 8));
  else if (k === 'escape') pin(null);
  else return;
  syncInputs();
});

// ---------------------------------------------------------------- scene
function defaultScene(reset) {
  if (reset) { clearAll(); emitters.length = 0; targets.length = 0; sources.length = 0; lamps.length = 0; field.clear(); }
  const g = GRADES[P.grade];
  addLamp(-2.35, g.lamps[0][0], g.lamps[0][1], g.lamps[0][2]);
  addLamp(0.45, g.lamps[1][0], g.lamps[1][1], g.lamps[1][2]);
  addLamp(2.2, g.lamps[2][0], g.lamps[2][1], g.lamps[2][2]);
  lamps.forEach(l => l.int = 0);   // fade the rig up
  buildLampUI();
  addEmitter(Math.PI, 'mix', 750, 1.3, .45);
  addEmitter(Math.PI * 1.16, 'K-', 420, 0.35, .7);
  targets.push({ x: W * 0.33, y: H * 0.56, r: 20 });
  bindu.rx = .5; bindu.ry = .5; bindu.x = W / 2; bindu.y = H / 2; seedTree();
  sources.push({ x: W * 0.72, y: H * 0.68, acc: 0, type: 'mixed', z: .3 });
}

let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const ow = W, oh = H; resize();
    const sx = W / ow, sy = H / oh;
    for (const o of [...targets, ...sources]) { o.x *= sx; o.y *= sy; }
    for (const o of [...emitters, ...lamps]) { o.x = o.rx * W; o.y = o.ry * H; }
    cones.length = 0; waves.length = 0;
    particles.length = 0; tracks.length = 0; pinned = null; showInspector();
  }, 150);
});

// ---------------------------------------------------------------- main loop
resize();
buildTools(); buildPanel(); setTool('shoot'); defaultScene(false);
setTimeout(() => $('#hint').classList.add('gone'), 9000);

let last = performance.now(), realAcc = 0, fpsAcc = 0, fpsN = 0, statT = 0, slowT = 0;
const root = document.documentElement;
function frame(now) {
  realAcc += (now - last) / 1000;
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  const time = now / 1000;
  if (!P.paused) simulate(dt);
  for (const st of pointers.values()) if (st.mode === 'field') field.paint(st.x, st.y, (st.neg ? -1 : 1) * P.brush * dt * 0.6, P.brushR);
  updateCamera(dt);
  if (!P.paused) updateWaves(dt);
  packLights(dt);
  render(time);
  drawOverlay(time);
  fpsAcc += dt; fpsN++; statT += dt;
  if (statT > 0.5) {
    const fps = fpsN / Math.max(realAcc, 1e-3); realAcc = 0;
    bubRate = bubblesThisSec / statT; bubblesThisSec = 0;
    $('#sLive').textContent = particles.length; $('#sTracks').textContent = tracks.length;
    $('#sBub').textContent = bubRate > 9999 ? (bubRate / 1000).toFixed(1) + 'k' : Math.round(bubRate);
    $('#sFps').textContent = Math.round(fps); fpsAcc = 0; fpsN = 0; statT = 0;
    $('#slens').textContent = `${P.aperture < .02 ? 'pinhole' : 'T' + (1.2 / Math.max(P.aperture, .05)).toFixed(1)} · ${(focusCur * 100).toFixed(0)} cm · ${GRADES[P.grade].name}`;
    // UI accent follows the key lamp
    const key = lamps[0]; if (key) root.style.setProperty('--accent', cssHue(key.hue, Math.min(key.sat, .8), .74));
    if (pinned) showInspector();
    if (tool === 'inspect' && mouse.x >= 0 && !pointers.size) updateHover(mouse.x, mouse.y);
    // adaptive resolution: step down if the GPU can't keep up, keeping the bubbles
    slowT = fps < 32 ? slowT + 0.5 : 0;
    if (slowT >= 2 && quality > 0.55 && fpsN === 0) {
      quality *= 0.85; slowT = 0;
      simScale = Math.min(DPR, 2200 / Math.max(W, H)) * quality; allocTargets(true);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__chamber = { P, particles, tracks, emitters, lamps, spawn, setTool, applyGrade, fireEmitter };
})();
