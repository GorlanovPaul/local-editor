import { filters, type Adjust, type EditState, type Geo } from './state'

type Aff = [number, number, number, number, number, number] // x'=a x + c y + e ; y'=b x + d y + f
const mul = (m: Aff, n: Aff): Aff => [ // m after n
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]
const T = (x: number, y: number): Aff => [1, 0, 0, 1, x, y]
const S = (x: number, y: number): Aff => [x, 0, 0, y, 0, 0]
const R = (a: number): Aff => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]

export function frameDims(g: Geo, w: number, h: number) { return g.rot % 2 ? { w: h, h: w } : { w, h } }
export function fillScale(a: number, W: number, H: number) {
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a))
  return Math.max((W * c + H * s) / W, (W * s + H * c) / H)
}
export function outDims(g: Geo, w: number, h: number, noCrop = false) {
  const f = frameDims(g, w, h), c = noCrop ? { w: 1, h: 1 } : g.crop
  return { w: Math.max(1, Math.round(f.w * c.w)), h: Math.max(1, Math.round(f.h * c.h)) }
}
/** maps output uv (0..1, y down) -> source uv */
export function geoMatrix(g: Geo, w: number, h: number, noCrop = false): Aff {
  const { w: W, h: H } = frameDims(g, w, h), c = noCrop ? { x: 0, y: 0, w: 1, h: 1 } : g.crop
  const a = g.angle * Math.PI / 180, s = fillScale(a, W, H)
  let m: Aff = [c.w, 0, 0, c.h, c.x, c.y]
  m = mul(T(-0.5, -0.5), m); m = mul(S(W, H), m); m = mul(R(-a), m); m = mul(S(1 / (s * W), 1 / (s * H)), m); m = mul(T(0.5, 0.5), m)
  if (g.flipH) m = mul([-1, 0, 0, 1, 1, 0], m)
  if (g.flipV) m = mul([1, 0, 0, -1, 0, 1], m)
  for (let i = 0; i < ((g.rot % 4) + 4) % 4; i++) m = mul([0, -1, 1, 0, 0, 1], m) // oriented(x,y) -> source(y,1-x)
  return m
}

export function effective(st: EditState): Adjust & { mono: number; fade: number; sh: number[]; hi: number[] } {
  const f = filters.find(x => x.id === st.filter.id) || filters[0], k = st.filter.strength / 100
  const r: any = { ...st.adj }
  for (const key in f.a || {}) r[key] = Math.max(-100, Math.min(100, r[key] + (f.a as any)[key] * k))
  r.mono = (f.mono || 0) * k; r.fade = (f.fade || 0) * k
  r.sh = (f.sh || [0, 0, 0]).map(v => v * k); r.hi = (f.hi || [0, 0, 0]).map(v => v * k)
  return r
}

const VS = `attribute vec2 p; uniform mat3 M; varying vec2 uv; varying vec2 ov;
void main(){ ov=p; uv=(M*vec3(p,1.0)).xy; gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0.0,1.0); }`
const FS = `precision highp float;
varying vec2 uv; varying vec2 ov; uniform sampler2D tex; uniform vec2 texel; uniform vec2 outSize;
uniform float uExp,uBri,uCon,uHi,uSh,uSat,uVib,uWarm,uTint,uSharp,uVig,uGrain,uBlur,uMono,uFade,uGs;
uniform vec3 uShT,uHiT; uniform sampler2D mask; uniform float uBgMode,uBgBlur; uniform vec3 uBgCol; uniform sampler2D sel; uniform float uRc,uSelShow; uniform vec3 uRcCol;
vec3 rgb2hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-10)),d/(q.x+1e-10),q.x);}
vec3 hsv2rgb(vec3 c){vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.);return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y);}
float lum(vec3 c){return dot(c,vec3(0.2126,0.7152,0.0722));}
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
void main(){
  if(uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0){gl_FragColor=vec4(0.0,0.0,0.0,uBgMode>0.5&&uBgMode<1.5?0.0:1.0);return;}
  vec3 c=texture2D(tex,uv).rgb; float m=uBgMode>0.0?texture2D(mask,uv).a:1.0; vec3 bb=vec3(0.0);
  if(uBgMode>2.5){for(int i=0;i<32;i++){float fi=float(i);float an=fi*2.39996;float rr=sqrt((fi+0.5)/32.0)*uBgBlur;bb+=texture2D(tex,uv+vec2(cos(an),sin(an))*rr*texel).rgb;} bb/=32.0;}
  if(uBlur>0.0){vec3 a=c;for(int i=0;i<24;i++){float fi=float(i);float an=fi*2.39996;float rr=sqrt((fi+0.5)/24.0)*uBlur;
    a+=texture2D(tex,uv+vec2(cos(an),sin(an))*rr*texel).rgb;} c=a/25.0;}
  if(uSharp>0.0){vec3 n=texture2D(tex,uv+vec2(texel.x,0.0)).rgb+texture2D(tex,uv-vec2(texel.x,0.0)).rgb+texture2D(tex,uv+vec2(0.0,texel.y)).rgb+texture2D(tex,uv-vec2(0.0,texel.y)).rgb;
    c+=(c-n*0.25)*uSharp*2.0;}
  if(uRc>0.0||uSelShow>0.0){float sm=texture2D(sel,uv).a;
    if(uRc>0.0){vec3 h=rgb2hsv(c);vec3 t=rgb2hsv(uRcCol);vec3 n=hsv2rgb(vec3(t.x,mix(h.y,t.y,0.75),mix(h.z,h.z*0.5+t.z*0.5,0.3)));c=mix(c,n,sm*uRc);}
    if(uSelShow>0.0)c=mix(c,vec3(0.25,0.55,1.0),sm*0.45);}
  c*=exp2(uExp*1.5);
  c+=uBri*0.25;
  float l=lum(c);
  c+=uSh*0.35*(1.0-smoothstep(0.0,0.55,l));
  c+=uHi*0.35*smoothstep(0.45,1.0,l);
  c=(c-0.5)*(1.0+uCon*0.8)+0.5;
  c.r+=uWarm*0.08; c.b-=uWarm*0.08; c.g-=uTint*0.06; c.r+=uTint*0.02; c.b+=uTint*0.02;
  l=lum(c);
  c=mix(vec3(l),c,1.0+uSat);
  float s=max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));
  c=mix(vec3(l),c,1.0+uVib*(1.0-clamp(s,0.0,1.0)));
  c=mix(c,vec3(lum(c)),uMono);
  l=clamp(lum(c),0.0,1.0); c+=uShT*(1.0-l)+uHiT*l;
  c=c*(1.0-uFade*0.25)+uFade*0.12;
  float d=length(ov-0.5)*1.4142;
  c*=1.0-uVig*0.8*smoothstep(0.3,1.0,d);
  if(uGrain>0.0){float g=hash(floor(ov*outSize/uGs))-0.5;c+=g*uGrain*0.25;}
  c=clamp(c,0.0,1.0); float al=1.0;
  if(uBgMode>2.5) c=mix(bb,c,m); else if(uBgMode>1.5) c=mix(uBgCol,c,m); else if(uBgMode>0.5) al=m;
  gl_FragColor=vec4(c,al);
}`

export class Renderer {
  gl: WebGLRenderingContext; prog: WebGLProgram; tex: WebGLTexture; mtex: WebGLTexture; stex: WebGLTexture; hasMask = false; hasSel = false; maskId = -1; selId = -1; srcId = -1; sw = 1; sh = 1; maxTex: number
  u: Record<string, WebGLUniformLocation | null> = {}
  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false })
    if (!gl) throw new Error('WebGL недоступен')
    this.gl = gl; this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) || 'shader'); return o }
    const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p); gl.useProgram(p); this.prog = p
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(p, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    for (const n of 'M tex texel outSize uExp uBri uCon uHi uSh uSat uVib uWarm uTint uSharp uVig uGrain uBlur uMono uFade uGs uShT uHiT mask uBgMode uBgBlur uBgCol sel uRc uSelShow uRcCol'.split(' ')) this.u[n] = gl.getUniformLocation(p, n)
    const mk = () => { const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t)
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
      return t }
    this.mtex = mk(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]))
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.mtex); gl.activeTexture(gl.TEXTURE0)
    this.stex = mk(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.stex); gl.activeTexture(gl.TEXTURE0)
    this.tex = mk()
  }
  setSource(img: TexImageSource, w: number, h: number) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); this.sw = w; this.sh = h
  }
  setMask(c: TexImageSource | null) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.mtex)
    if (c) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]))
    gl.activeTexture(gl.TEXTURE0); this.hasMask = !!c
  }
  setSel(c: TexImageSource | null) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.stex)
    if (c) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
    gl.activeTexture(gl.TEXTURE0); this.hasSel = !!c
  }
  /** renders; returns output size */
  render(st: EditState, o: { noCrop?: boolean; original?: boolean; w?: number; h?: number; showSel?: boolean } = {}) {
    const gl = this.gl, g = o.original ? { ...st.geo, rot: 0, flipH: false, flipV: false, angle: 0 } : st.geo
    const noCrop = o.noCrop || o.original
    const d = outDims(g, this.sw, this.sh, noCrop), W = o.w || d.w, H = o.h || d.h
    if (this.canvas.width !== W) this.canvas.width = W
    if (this.canvas.height !== H) this.canvas.height = H
    gl.viewport(0, 0, W, H)
    const m = geoMatrix(g, this.sw, this.sh, noCrop)
    gl.uniformMatrix3fv(this.u.M, false, [m[0], m[1], 0, m[2], m[3], 0, m[4], m[5], 1])
    gl.uniform1i(this.u.tex, 0); gl.uniform2f(this.u.texel, 1 / this.sw, 1 / this.sh); gl.uniform2f(this.u.outSize, W, H)
    const e = effective(st), z = o.original ? 0 : 1, f = (k: string, v: number) => gl.uniform1f(this.u[k], v * z)
    f('uExp', e.exposure / 100); f('uBri', e.brightness / 100); f('uCon', e.contrast / 100); f('uHi', e.highlights / 100); f('uSh', e.shadows / 100)
    f('uSat', e.saturation / 100); f('uVib', e.vibrance / 100); f('uWarm', e.warmth / 100); f('uTint', e.tint / 100); f('uSharp', e.sharpness / 100)
    f('uVig', e.vignette / 100); f('uGrain', e.grain / 100); f('uMono', e.mono); f('uFade', e.fade)
    f('uBlur', e.blur / 100 * 0.025 * Math.max(this.sw, this.sh)); gl.uniform1f(this.u.uGs, Math.max(1, Math.max(W, H) / 1400))
    gl.uniform3fv(this.u.uShT, e.sh.map(v => v * z)); gl.uniform3fv(this.u.uHiT, e.hi.map(v => v * z))
    const bm = o.original || !this.hasMask ? 0 : ({ off: 0, transparent: 1, color: 2, blur: 3 } as any)[st.bg.mode] || 0
    gl.uniform1i(this.u.mask, 1); gl.uniform1f(this.u.uBgMode, bm); gl.uniform1f(this.u.uBgBlur, st.bg.blur / 100 * 0.04 * Math.max(this.sw, this.sh))
    const hx = st.bg.color; gl.uniform3f(this.u.uBgCol, parseInt(hx.slice(1, 3), 16) / 255, parseInt(hx.slice(3, 5), 16) / 255, parseInt(hx.slice(5, 7), 16) / 255)
    const rc = !o.original && this.hasSel && st.recolor.mask && this.selId === st.recolor.mask ? st.recolor.amount / 100 : 0, rx = st.recolor.color
    gl.uniform1i(this.u.sel, 2); gl.uniform1f(this.u.uRc, rc); gl.uniform1f(this.u.uSelShow, o.showSel && this.hasSel ? 1 : 0)
    gl.uniform3f(this.u.uRcCol, parseInt(rx.slice(1, 3), 16) / 255, parseInt(rx.slice(3, 5), 16) / 255, parseInt(rx.slice(5, 7), 16) / 255)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return { w: W, h: H }
  }
}
