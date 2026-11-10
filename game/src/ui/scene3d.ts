import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { GameState } from '../game/state'
import { ETA_INIT } from '../game/constants'
import { loadAllTextures, phong, basic, type SceneTextures } from './textures'
import { setHudLayout } from './hudLayout'

export type CameraMode = 'orbit' | 'free' | 'interior'

let renderer: THREE.WebGLRenderer
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let controls: OrbitControls | null = null
let spacecraft: THREE.Group
let exteriorGroup: THREE.Group
let interiorGroup: THREE.Group
let earth: THREE.Mesh
let earthGlow: THREE.Mesh
let skybox: THREE.Mesh
let starPoints: THREE.Points
let o2Particles: THREE.Points
let trailLine: THREE.Line
let ambientLight: THREE.AmbientLight
let sunLight: THREE.DirectionalLight
let cabinLight: THREE.PointLight
let heaterGlow: THREE.Mesh
let filterRing: THREE.Mesh
let navBeacon: THREE.Mesh
let o2Vent: THREE.Mesh
let cockpitAnchor: THREE.Object3D
let sceneFog: THREE.FogExp2 | null = null

let cameraMode: CameraMode = 'orbit'
let targetYaw = 0
let targetPitch = 0
let smoothYaw = 0
let smoothPitch = 0
let smoothRoll = 0
let orbitAngle = 0
let lastWall = 0
let brownoutFlash = 0
let textures: SceneTextures

const o2Positions = new Float32Array(120 * 3)
const o2Velocities: THREE.Vector3[] = []
const _lookTarget = new THREE.Vector3()

function makeStarPoints(): THREE.Points {
  const count = 2000
  const pos = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const r = 80 + Math.random() * 120
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta)
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    pos[i * 3 + 2] = r * Math.cos(phi)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, sizeAttenuation: true })
  return new THREE.Points(geo, mat)
}

function makeSkybox(tex: THREE.Texture | null): THREE.Mesh {
  const geo = new THREE.SphereGeometry(150, 32, 32)
  const mat = basic(tex, 0x000008, { side: THREE.BackSide })
  return new THREE.Mesh(geo, mat)
}

function makeEarth(tex: THREE.Texture | null): THREE.Mesh {
  const geo = new THREE.SphereGeometry(12, 48, 48)
  const mat = phong(tex, 0x1a4a8a, { emissive: 0x0a2040, shininess: 20 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(0, -8, -55)
  return mesh
}

function makeEarthAtmosphere(tex: THREE.Texture | null): THREE.Mesh {
  const geo = new THREE.SphereGeometry(12.6, 32, 32)
  const mat = basic(tex, 0x4488ff, { transparent: true, opacity: tex ? 0.35 : 0.12, side: THREE.BackSide })
  return new THREE.Mesh(geo, mat)
}

function makeCockpitFrame(tex: SceneTextures): THREE.Group {
  const frame = new THREE.Group()
  const metal = phong(tex.frame, 0x4a4a52, { shininess: 50 })
  const dark  = phong(tex.cabinInterior, 0x2a2a30, { shininess: 30 })

  // 左柱
  const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5, 0.1), metal)
  leftPillar.position.set(-0.62, 0.42, -0.05)
  frame.add(leftPillar)

  // 右柱
  const rightPillar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5, 0.1), metal)
  rightPillar.position.set(0.62, 0.42, -0.05)
  frame.add(rightPillar)

  // 頂樑
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.1, 0.12), metal)
  topBar.position.set(0, 1.02, -0.12)
  frame.add(topBar)

  // 窗台
  const sill = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.08, 0.14), metal)
  sill.position.set(0, 0.02, -0.18)
  frame.add(sill)

  // 左斜撐
  const leftBrace = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), dark)
  leftBrace.position.set(-0.58, 0.72, 0.08)
  leftBrace.rotation.z = 0.25
  frame.add(leftBrace)

  // 右斜撐
  const rightBrace = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), dark)
  rightBrace.position.set(0.58, 0.72, 0.08)
  rightBrace.rotation.z = -0.25
  frame.add(rightBrace)

  // 側壁（不擋正前方）
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.55), dark)
    wall.position.set(side * 0.78, 0.38, 0.22)
    wall.rotation.y = side * 0.2
    frame.add(wall)
  }

  // 頂部艙壁
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), dark)
  ceiling.position.set(0, 1.12, 0.18)
  ceiling.rotation.x = Math.PI / 2
  frame.add(ceiling)

  // 擋風玻璃（透明，朝駕駛員）
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: tex.glass ? 0xffffff : 0x88aacc,
    map: tex.glass ?? undefined,
    transparent: true,
    opacity: 0.18,
    roughness: 0.05,
    metalness: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.82), glassMat)
  windshield.position.set(0, 0.52, -0.38)
  windshield.renderOrder = 1
  frame.add(windshield)

  // 玻璃外框
  const ringMat = metal.clone()
  for (const [w, h, x, y] of [
    [1.22, 0.06, 0, 0.92],   // top
    [1.22, 0.06, 0, 0.12],   // bottom
    [0.06, 0.82, -0.58, 0.52], // left
    [0.06, 0.82, 0.58, 0.52],  // right
  ] as const) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), ringMat)
    seg.position.set(x, y, -0.36)
    frame.add(seg)
  }

  return frame
}

function makeSpacecraft(tex: SceneTextures): { root: THREE.Group; exterior: THREE.Group; interior: THREE.Group } {
  const root = new THREE.Group()
  const exterior = new THREE.Group()
  const interior = new THREE.Group()

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.4, 4.5, 24),
    phong(tex.body, 0xcccccc, { shininess: 60 }),
  )
  body.rotation.x = Math.PI / 2
  exterior.add(body)

  const shield = new THREE.Mesh(
    new THREE.ConeGeometry(1.4, 1.8, 24),
    phong(tex.shield, 0x8b4513, { shininess: 30 }),
  )
  shield.rotation.x = -Math.PI / 2
  shield.position.z = 3.15
  exterior.add(shield)

  const tunnel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.6, 1.2, 16),
    phong(tex.tunnel, 0xaaaaaa, { shininess: 50 }),
  )
  tunnel.rotation.x = Math.PI / 2
  tunnel.position.z = -2.85
  exterior.add(tunnel)

  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 0.05, 1.2),
      phong(tex.panel, 0x1a3366, { emissive: 0x0a1a33, shininess: 80 }),
    )
    panel.position.set(side * 2.8, 0, 0)
    exterior.add(panel)
  }

  const win = new THREE.Mesh(
    new THREE.CircleGeometry(0.25, 16),
    basic(tex.window, 0x224466, { transparent: true, opacity: tex.window ? 0.9 : 1 }),
  )
  win.position.set(0, 1.21, -0.5)
  win.rotation.x = -Math.PI / 2
  exterior.add(win)

  interior.add(makeCockpitFrame(tex))

  root.add(exterior, interior)
  interior.visible = false
  return { root, exterior, interior }
}

function makeIndicatorGlow(color: number, pos: THREE.Vector3): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 8, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 }),
  )
  mesh.position.copy(pos)
  return mesh
}

function initO2Particles(tex: THREE.Texture | null): THREE.Points {
  for (let i = 0; i < 40; i++) o2Velocities.push(new THREE.Vector3())
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(o2Positions, 3))
  const mat = new THREE.PointsMaterial({
    color: 0xaaddff,
    map: tex ?? undefined,
    size: tex ? 0.35 : 0.12,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: true,
    depthWrite: false,
    alphaTest: tex ? 0.1 : 0,
  })
  return new THREE.Points(geo, mat)
}

export async function initScene3d(container: HTMLElement): Promise<void> {
  textures = await loadAllTextures()

  scene = new THREE.Scene()
  sceneFog = new THREE.FogExp2(0x000008, 0.004)
  scene.fog = sceneFog

  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400)
  camera.position.set(6, 3, 8)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000008)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 4
  controls.maxDistance = 25
  controls.enabled = false

  ambientLight = new THREE.AmbientLight(0x334466, 0.4)
  scene.add(ambientLight)

  sunLight = new THREE.DirectionalLight(0xffffff, 1.2)
  sunLight.position.set(5, 8, 10)
  scene.add(sunLight)

  cabinLight = new THREE.PointLight(0xffeedd, 0.6, 15)
  scene.add(cabinLight)

  skybox = makeSkybox(textures.skybox)
  scene.add(skybox)
  starPoints = makeStarPoints()
  scene.add(starPoints)
  starPoints.visible = !textures.skybox

  earth = makeEarth(textures.earthDiffuse)
  scene.add(earth)
  earthGlow = makeEarthAtmosphere(textures.earthAtmosphere)
  scene.add(earthGlow)

  const craft = makeSpacecraft(textures)
  spacecraft = craft.root
  exteriorGroup = craft.exterior
  interiorGroup = craft.interior
  scene.add(spacecraft)

  cockpitAnchor = new THREE.Object3D()
  cockpitAnchor.position.set(0, 0.22, 0.42)
  spacecraft.add(cockpitAnchor)

  heaterGlow = makeIndicatorGlow(0xff4400, new THREE.Vector3(1.3, 0.5, 1))
  filterRing = makeIndicatorGlow(0x00ff88, new THREE.Vector3(-1.3, 0.3, 0.5))
  navBeacon = makeIndicatorGlow(0x00aaff, new THREE.Vector3(0, 1.3, -1))
  o2Vent = makeIndicatorGlow(0x88ccff, new THREE.Vector3(0, -1.2, 1.5))
  spacecraft.add(heaterGlow, filterRing, navBeacon, o2Vent)

  o2Particles = initO2Particles(textures.particle)
  spacecraft.add(o2Particles)

  const trailGeo = new THREE.BufferGeometry()
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
  trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0x00ff44, transparent: true, opacity: 0.5 }))
  scene.add(trailLine)

  onResize()
  window.addEventListener('resize', onResize)
}

export function setCameraMode(mode: CameraMode): void {
  cameraMode = mode
  setHudLayout(mode)
  if (!controls) return

  if (mode === 'free') {
    controls.enabled = true
    controls.target.copy(spacecraft.position)
    exteriorGroup.visible = true
    interiorGroup.visible = false
    trailLine.visible = true
    scene.fog = sceneFog
  } else if (mode === 'interior') {
    controls.enabled = false
    exteriorGroup.visible = false
    interiorGroup.visible = true
    trailLine.visible = false
    scene.fog = null
    camera.fov = 72
    camera.updateProjectionMatrix()
  } else {
    controls.enabled = false
    exteriorGroup.visible = true
    interiorGroup.visible = false
    trailLine.visible = true
    scene.fog = sceneFog
    camera.fov = 55
    camera.updateProjectionMatrix()
  }
}

export function getCameraMode(): CameraMode {
  return cameraMode
}

export function onResize(): void {
  if (!renderer || !camera) return
  const parent = renderer.domElement.parentElement
  if (!parent) return
  const w = parent.clientWidth
  const h = parent.clientHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}

function updateCamera(s: GameState, dt: number): void {
  if (cameraMode === 'interior') {
    cockpitAnchor.getWorldPosition(_lookTarget)
    camera.position.copy(_lookTarget)

    // 正前方望向太空（本船 -Z 軸）
    const lookAt = new THREE.Vector3(0, 0.18, -120)
    spacecraft.localToWorld(lookAt)
    camera.lookAt(lookAt)

    const shake = s.dev / 50
    camera.position.x += shake * 0.025 * Math.sin(s.elapsed * 3)
    camera.position.y += shake * 0.018 * Math.cos(s.elapsed * 2.5)
    camera.rotation.z = smoothRoll * 0.4
    return
  }

  if (cameraMode === 'free') {
    controls!.target.lerp(spacecraft.position, 1 - Math.pow(0.05, dt))
    controls!.update()
    return
  }

  // orbit — 自動環繞
  orbitAngle += dt * 0.12
  const camDist = 9 + Math.sin(orbitAngle * 0.3) * 1.5
  const camH = 2.5 + Math.sin(orbitAngle * 0.5) * 0.8
  camera.position.set(
    spacecraft.position.x + Math.cos(orbitAngle) * camDist,
    spacecraft.position.y + camH,
    spacecraft.position.z + Math.sin(orbitAngle) * camDist + 2,
  )
  camera.lookAt(spacecraft.position)
}

export function updateScene3d(s: GameState): void {
  if (!renderer) return

  const now = performance.now() / 1000
  const dt = lastWall > 0 ? Math.min(now - lastWall, 0.05) : 0.016
  lastWall = now

  const devFactor = s.dev / 50
  if (s.devices.navComp.on) {
    targetYaw   = devFactor * 0.35 * Math.sin(s.elapsed * 0.8)
    targetPitch = devFactor * 0.2  * Math.cos(s.elapsed * 0.6)
  } else {
    targetYaw   = devFactor * 0.9  * Math.sin(s.elapsed * 1.4 + 1)
    targetPitch = devFactor * 0.55 * Math.cos(s.elapsed * 1.1)
  }
  const lerp = 1 - Math.pow(0.02, dt)
  smoothYaw   += (targetYaw   - smoothYaw)   * lerp
  smoothPitch += (targetPitch - smoothPitch) * lerp
  smoothRoll  += ((s.devices.navComp.on ? 0 : devFactor * 0.15 * Math.sin(s.elapsed * 2)) - smoothRoll) * lerp

  spacecraft.rotation.set(smoothPitch, smoothYaw, smoothRoll)
  spacecraft.rotation.y += dt * 0.05

  setGlow(heaterGlow, s.devices.heater.on, 0xff4400, s.devices.heater.degraded ? 0.5 : 1)
  setGlow(filterRing, s.devices.co2Filter.on, 0x00ff88, s.devices.co2Filter.degraded ? 0.5 : 1)
  setGlow(navBeacon, s.devices.navComp.on, 0x00aaff, s.devices.navComp.degraded ? 0.5 : 1)
  setGlow(o2Vent, s.o2Releasing, 0x88ccff, 1)

  if (s.devices.co2Filter.on) filterRing.rotation.z += dt * 4
  navBeacon.scale.setScalar(s.devices.navComp.on ? 1 + 0.15 * Math.sin(s.elapsed * 6) : 1)

  updateO2Particles(s, dt)

  const pwr = s.mainPwr / 100
  if (s.brownout) {
    brownoutFlash += dt * 12
    const flicker = Math.sin(brownoutFlash * 20) > 0 ? 0.05 : 0.3
    cabinLight.intensity = flicker
    ambientLight.intensity = 0.1
  } else {
    brownoutFlash = 0
    if (cameraMode === 'interior') {
      cabinLight.intensity = 0.08 + pwr * 0.15
      ambientLight.intensity = 0.08
    } else {
      cabinLight.intensity = 0.15 + pwr * 0.7
      ambientLight.intensity = 0.15 + pwr * 0.35
    }
  }

  if (cameraMode === 'interior') {
    cockpitAnchor.getWorldPosition(cabinLight.position)
    sunLight.intensity = 1.8
  } else {
    spacecraft.getWorldPosition(cabinLight.position)
    sunLight.intensity = 1.2
  }

  const cold = Math.max(0, (15 - s.temp) / 15)
  if (cameraMode !== 'interior') {
    renderer.setClearColor(new THREE.Color().setHSL(0.6, 0.3 * cold, 0.02 + 0.01 * (1 - cold)))
  } else {
    renderer.setClearColor(0x000008)
  }

  earth.rotation.y += dt * 0.02
  earthGlow.rotation.y = earth.rotation.y
  skybox.rotation.y += dt * 0.001
  starPoints.rotation.y += dt * 0.003

  const trailPts = trailLine.geometry.attributes.position as THREE.BufferAttribute
  const devOff = new THREE.Vector3(
    Math.sin(smoothYaw) * s.dev * 0.08,
    Math.sin(smoothPitch) * s.dev * 0.05,
    -s.dev * 0.15,
  )
  trailPts.setXYZ(0, spacecraft.position.x, spacecraft.position.y, spacecraft.position.z)
  trailPts.setXYZ(1,
    spacecraft.position.x + devOff.x * 3,
    spacecraft.position.y + devOff.y * 3,
    spacecraft.position.z - 8,
  )
  trailPts.needsUpdate = true
  const trailColor = s.dev > 30 ? 0xff4400 : s.dev > 15 ? 0xffaa00 : 0x00ff44
  ;(trailLine.material as THREE.LineBasicMaterial).color.setHex(trailColor)

  const progress = 1 - s.eta / ETA_INIT
  const earthZ = -55 + progress * 20
  earth.position.z = earthZ
  earthGlow.position.z = earthZ
  earth.scale.setScalar(1 + progress * 0.3)

  updateCamera(s, dt)
  renderer.render(scene, camera)
}

function setGlow(mesh: THREE.Mesh, on: boolean, color: number, brightness: number): void {
  const mat = mesh.material as THREE.MeshBasicMaterial
  mat.color.setHex(color)
  mat.opacity = on ? 0.7 * brightness + 0.2 * Math.sin(performance.now() * 0.005) : 0
}

function updateO2Particles(s: GameState, dt: number): void {
  const attr = o2Particles.geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < 40; i++) {
    const i3 = i * 3
    if (s.o2Releasing && Math.random() < 0.3) {
      o2Positions[i3]     = (Math.random() - 0.5) * 0.3
      o2Positions[i3 + 1] = -1.2
      o2Positions[i3 + 2] = 1.5 + Math.random() * 0.2
      o2Velocities[i].set((Math.random() - 0.5) * 0.5, -0.5 - Math.random(), 1 + Math.random() * 2)
    } else if (!s.o2Releasing) {
      o2Positions[i3 + 2] = -999
    } else {
      o2Positions[i3]     += o2Velocities[i].x * dt
      o2Positions[i3 + 1] += o2Velocities[i].y * dt
      o2Positions[i3 + 2] += o2Velocities[i].z * dt
      if (o2Positions[i3 + 2] > 6) o2Positions[i3 + 2] = -999
    }
  }
  attr.needsUpdate = true
  o2Particles.visible = s.o2Releasing
}
