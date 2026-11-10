/**
 * 舷窗外的宇宙：Three.js + 自寫 shader，完全程序化（不需貼圖）。
 * - 地球：fbm 噪聲大陸/海洋、雲層、晨昏線、夜間城市光、大氣邊緣輝光
 * - 月球：fbm + 隕石坑
 * - 星空：閃爍點精靈
 * - 冰晶碎片：歷史上組員看到艙外漂浮的「雪花」，放氧時噴出更多
 * 航程進度 p ∈ [0,1] 決定月球/地球的遠近：前 1/4 接近月球、繞到背面，之後地球漸大。
 * 太空艙緩慢滾轉（真實的被動熱控制 PTC「烤肉滾轉」）。
 */
import * as THREE from 'three'

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let earth: THREE.Mesh, earthAtmo: THREE.Mesh, moon: THREE.Mesh
let stars: THREE.Points, debris: THREE.Points
let sunSprite: THREE.Sprite
let container: HTMLElement
let roll = 0
let last = performance.now()
const debrisVel: THREE.Vector3[] = []
const DEBRIS = 160
const SUN_DIR = new THREE.Vector3(1, 0.25, 0.35).normalize()

const NOISE = /* glsl */ `
vec3 hash3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6)));
  return -1.0 + 2.0*fract(sin(p)*43758.5453123); }
float noise(vec3 p){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*(3.0-2.0*f);
  return mix(mix(mix(dot(hash3(i+vec3(0,0,0)),f-vec3(0,0,0)), dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
                 mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)), dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
             mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)), dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
                 mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)), dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z); }
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<6;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
`

const SPHERE_VS = /* glsl */ `
varying vec3 vN; varying vec3 vP; varying vec3 vWN; varying vec3 vView;
void main(){
  vP = position;
  vN = normalize(position);
  vWN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position,1.0);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`

function earthMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR }, uTime: { value: 0 } },
    vertexShader: SPHERE_VS,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform float uTime;
      varying vec3 vN; varying vec3 vWN; varying vec3 vView;
      ${NOISE}
      void main(){
        vec3 n = vN;
        float h = fbm(n*2.2 + 3.1);
        float land = smoothstep(0.02, 0.06, h);
        float lat = abs(n.y);
        vec3 ocean = mix(vec3(0.02,0.09,0.25), vec3(0.03,0.2,0.42), smoothstep(-0.3,0.05,h));
        vec3 green = mix(vec3(0.12,0.28,0.1), vec3(0.45,0.38,0.2), smoothstep(0.08,0.3,h + fbm(n*7.0)*0.3));
        vec3 col = mix(ocean, green, land);
        col = mix(col, vec3(0.92,0.95,1.0), smoothstep(0.78,0.86,lat + h*0.2)); // 極冠
        float cl = fbm(n*3.5 + vec3(uTime*0.01, 0.0, uTime*0.006));
        float clouds = smoothstep(0.05, 0.35, cl + 0.08);
        col = mix(col, vec3(1.0), clouds*0.85);
        float d = dot(normalize(vWN), uSun);
        float day = smoothstep(-0.12, 0.25, d);
        float spec = pow(max(dot(reflect(-uSun, normalize(vWN)), vView), 0.0), 30.0) * (1.0-land) * (1.0-clouds) * 0.6;
        vec3 night = vec3(1.0,0.75,0.4) * land * (1.0-clouds) * smoothstep(0.25,0.5,fbm(n*28.0)+0.3) * 0.35;
        vec3 lit = col * (0.04 + day*1.05) + spec*day + night*(1.0-day);
        float rim = pow(1.0 - max(dot(normalize(vWN), vView), 0.0), 3.0);
        lit += vec3(0.3,0.55,1.0) * rim * (0.25 + day*0.9);
        gl_FragColor = vec4(lit, 1.0);
      }`,
  })
}

function atmoMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: SPHERE_VS,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; varying vec3 vWN; varying vec3 vView;
      void main(){
        float rim = 1.0 - max(dot(normalize(vWN), vView), 0.0);
        float a = pow(rim, 2.4) * smoothstep(-0.4, 0.4, dot(normalize(vWN), uSun) + 0.2);
        gl_FragColor = vec4(vec3(0.35,0.6,1.0)*1.4, a);
      }`,
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  })
}

function moonMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: SPHERE_VS,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; varying vec3 vN; varying vec3 vWN; varying vec3 vView;
      ${NOISE}
      float crater(vec3 p, float scale){
        vec3 q = p*scale; vec3 i = floor(q); vec3 f = fract(q);
        float c = 0.0;
        for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){
          vec3 g = vec3(x,y,z); vec3 o = 0.5+0.5*hash3(i+g);
          float r = length(g+o-f);
          float rad = 0.25 + 0.2*hash3(i+g+7.0).x;
          c += smoothstep(rad, rad*0.6, r)*-0.5 + smoothstep(rad*1.25, rad, r)*smoothstep(rad*0.8, rad, r)*0.6;
        }
        return c;
      }
      void main(){
        vec3 n = vN;
        float maria = smoothstep(0.0, 0.25, fbm(n*1.6+11.0));
        float base = 0.55 + fbm(n*6.0)*0.25 - maria*0.22;
        float cr = crater(n, 5.0)*0.12 + crater(n, 13.0)*0.06;
        vec3 col = vec3(base + cr) * vec3(1.0, 0.98, 0.95);
        float d = max(dot(normalize(vWN), uSun), 0.0);
        float lit = pow(d, 0.8);
        gl_FragColor = vec4(col * (0.015 + lit*1.15), 1.0);
      }`,
  })
}

function makeStars(): THREE.Points {
  const N = 2600
  const pos = new Float32Array(N * 3), size = new Float32Array(N), tw = new Float32Array(N), tint = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(400)
    pos.set([v.x, v.y, v.z], i * 3)
    size[i] = Math.pow(Math.random(), 6) * 5 + 0.8
    tw[i] = Math.random() * 6.28
    const t = Math.random()
    tint.set(t < 0.15 ? [1, 0.8, 0.6] : t < 0.3 ? [0.7, 0.8, 1] : [1, 1, 1], i * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  g.setAttribute('aTw', new THREE.BufferAttribute(tw, 1))
  g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3))
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute float aTw; attribute vec3 aTint;
      uniform float uTime; uniform float uPx; varying float vA; varying vec3 vT;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
        vA = 0.65 + 0.35*sin(uTime*1.7 + aTw); vT = aTint; gl_PointSize = aSize*uPx; }`,
    fragmentShader: /* glsl */ `
      varying float vA; varying vec3 vT;
      void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d); gl_FragColor = vec4(vT, a*vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  return new THREE.Points(g, m)
}

function makeDebris(): THREE.Points {
  const pos = new Float32Array(DEBRIS * 3)
  for (let i = 0; i < DEBRIS; i++) {
    resetDebris(pos, i, true)
    debrisVel.push(new THREE.Vector3())
    randomVel(debrisVel[i], 0.15)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const m = new THREE.PointsMaterial({ color: 0xdfefff, size: 0.05, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
  return new THREE.Points(g, m)
}
function randomVel(v: THREE.Vector3, s: number): void { v.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, -Math.random() * s * 2) }
function resetDebris(pos: Float32Array, i: number, anywhere: boolean): void {
  pos[i * 3] = (Math.random() - 0.5) * 4
  pos[i * 3 + 1] = (Math.random() - 0.5) * 3
  pos[i * 3 + 2] = anywhere ? -Math.random() * 12 - 1 : -1
}

function makeSun(): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.08, 'rgba(255,250,235,0.95)')
  grd.addColorStop(0.25, 'rgba(255,220,170,0.25)'); grd.addColorStop(1, 'rgba(255,200,150,0)')
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false }))
  s.scale.setScalar(60)
  s.position.copy(SUN_DIR).multiplyScalar(300)
  return s
}

export function initSpace(el: HTMLElement): boolean {
  container = el
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  } catch {
    el.style.background = 'radial-gradient(circle at 30% 40%, #1a3b6b, #000 60%)'
    return false
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setClearColor(0x000000)
  el.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(55, 1, 0.01, 1000)

  stars = makeStars(); scene.add(stars)
  sunSprite = makeSun(); scene.add(sunSprite)

  earth = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), earthMaterial())
  earthAtmo = new THREE.Mesh(new THREE.SphereGeometry(1.06, 64, 64), atmoMaterial())
  earth.add(earthAtmo)
  earth.rotation.z = 0.41
  scene.add(earth)

  moon = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), moonMaterial())
  scene.add(moon)

  debris = makeDebris(); camera.add(debris); scene.add(camera)

  resize()
  new ResizeObserver(resize).observe(el)
  return true
}

function resize(): void {
  if (!renderer) return
  const w = container.clientWidth || 1, h = container.clientHeight || 1
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  ;(stars.material as THREE.ShaderMaterial).uniforms.uPx.value = renderer.getPixelRatio()
}

/** 依航程把天體放到相機視角裡（以「視角大小」設計，不追求真實比例） */
function place(p: number): void {
  // 月球：p=0 時已不小，p≈0.24 近月點時最大（填滿舷窗一側），之後遠去
  const dPeri = Math.abs(p - 0.244)
  const moonAng = p < 0.244 ? THREE.MathUtils.lerp(0.30, 1.05, Math.pow(p / 0.244, 2)) : THREE.MathUtils.lerp(1.05, 0.05, Math.min(1, Math.pow(dPeri / 0.75, 0.6)))
  const moonDir = new THREE.Vector3(-0.55 + (p > 0.244 ? (p - 0.244) * 1.2 : 0), -0.1, -1).normalize()
  moon.position.copy(moonDir).multiplyScalar(40)
  moon.scale.setScalar(40 * Math.tan(moonAng / 2))

  // 地球：前期很小，最後 15% 迅速放大到佔滿舷窗
  const earthAng = p < 0.85 ? THREE.MathUtils.lerp(0.035, 0.22, Math.pow(p / 0.85, 2.2)) : THREE.MathUtils.lerp(0.22, 1.5, Math.pow((p - 0.85) / 0.15, 1.6))
  const earthDir = new THREE.Vector3(0.45 - p * 0.35, 0.12 - p * 0.25, -1).normalize()
  earth.position.copy(earthDir).multiplyScalar(60)
  earth.scale.setScalar(60 * Math.tan(earthAng / 2))
}

export function renderSpace(o: { progress: number; o2Releasing: boolean; burning: boolean; running: boolean }): void {
  if (!renderer) return
  const now = performance.now()
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  const t = now / 1000

  place(Math.max(0, Math.min(1, o.progress)))
  // PTC 滾轉：視角緩慢搖擺（不轉離天體太遠，讓玩家始終看得到）
  roll += dt * (o.burning ? 0.0 : 1)
  camera.rotation.set(Math.sin(roll * 0.05) * 0.08, Math.sin(roll * 0.037) * 0.12, roll * 0.02)
  if (o.burning) camera.position.set((Math.random() - 0.5) * 0.004, (Math.random() - 0.5) * 0.004, 0)
  else camera.position.set(0, 0, 0)

  earth.rotation.y += dt * 0.02
  moon.rotation.y += dt * 0.003
  ;(earth.material as THREE.ShaderMaterial).uniforms.uTime.value = t
  ;(stars.material as THREE.ShaderMaterial).uniforms.uTime.value = t

  // 冰晶碎片
  const pos = (debris.geometry.getAttribute('position') as THREE.BufferAttribute)
  const arr = pos.array as Float32Array
  const boost = o.o2Releasing ? 6 : 1
  for (let i = 0; i < DEBRIS; i++) {
    const v = debrisVel[i]
    arr[i * 3] += v.x * dt * boost
    arr[i * 3 + 1] += v.y * dt * boost
    arr[i * 3 + 2] += v.z * dt * boost
    if (arr[i * 3 + 2] < -14 || Math.abs(arr[i * 3]) > 6 || Math.abs(arr[i * 3 + 1]) > 5) {
      resetDebris(arr, i, false)
      randomVel(v, o.o2Releasing ? 0.9 : 0.15)
    }
  }
  pos.needsUpdate = true
  ;(debris.material as THREE.PointsMaterial).opacity = o.o2Releasing ? 1 : 0.55

  renderer.render(scene, camera)
}

export function viewLabel(p: number): string {
  if (p < 0.2) return '月球接近中 · LUNAR APPROACH'
  if (p < 0.29) return '月球背面 · FAR SIDE'
  if (p < 0.8) return '返航中 · TRANS-EARTH COAST'
  if (p < 0.97) return '地球接近中 · EARTH APPROACH'
  return '再入走廊 · ENTRY INTERFACE'
}
