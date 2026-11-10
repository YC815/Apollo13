import * as THREE from 'three'
import { TEXTURE_MANIFEST } from './textureManifest'

const loader = new THREE.TextureLoader()

function configure(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function loadTexture(path: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    loader.load(path, (tex) => resolve(configure(tex)), undefined, () => resolve(null))
  })
}

export type SceneTextures = {
  body: THREE.Texture | null
  shield: THREE.Texture | null
  tunnel: THREE.Texture | null
  panel: THREE.Texture | null
  window: THREE.Texture | null
  cabinInterior: THREE.Texture | null
  instrumentPanel: THREE.Texture | null
  button: THREE.Texture | null
  gaugeFace: THREE.Texture | null
  frame: THREE.Texture | null
  glass: THREE.Texture | null
  earthDiffuse: THREE.Texture | null
  earthAtmosphere: THREE.Texture | null
  skybox: THREE.Texture | null
  particle: THREE.Texture | null
}

export async function loadAllTextures(): Promise<SceneTextures> {
  const m = TEXTURE_MANIFEST
  const [
    body, shield, tunnel, panel, window, cabinInterior,
    instrumentPanel, button, gaugeFace, frame, glass,
    earthDiffuse, earthAtmosphere, skybox, particle,
  ] = await Promise.all([
    loadTexture(m.spacecraft.body.path),
    loadTexture(m.spacecraft.shield.path),
    loadTexture(m.spacecraft.tunnel.path),
    loadTexture(m.spacecraft.panel.path),
    loadTexture(m.spacecraft.window.path),
    loadTexture(m.spacecraft.cabinInterior.path),
    loadTexture(m.cockpit.instrumentPanel.path),
    loadTexture(m.cockpit.button.path),
    loadTexture(m.cockpit.gaugeFace.path),
    loadTexture(m.cockpit.frame.path),
    loadTexture(m.cockpit.glass.path),
    loadTexture(m.earth.diffuse.path),
    loadTexture(m.earth.atmosphere.path),
    loadTexture(m.stars.skybox.path),
    loadTexture(m.stars.particle.path),
  ])
  return {
    body, shield, tunnel, panel, window, cabinInterior,
    instrumentPanel, button, gaugeFace, frame, glass,
    earthDiffuse, earthAtmosphere, skybox, particle,
  }
}

export function phong(
  tex: THREE.Texture | null,
  fallback: number,
  opts: { emissive?: number; shininess?: number } = {},
): THREE.MeshPhongMaterial {
  const mat = new THREE.MeshPhongMaterial({
    color: fallback,
    emissive: opts.emissive ?? 0x000000,
    shininess: opts.shininess ?? 40,
  })
  if (tex) {
    mat.map = tex
    mat.color.setHex(0xffffff)
  }
  return mat
}

export function basic(
  tex: THREE.Texture | null,
  fallback: number,
  opts: { transparent?: boolean; opacity?: number; side?: THREE.Side } = {},
): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color: fallback,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  })
  if (tex) {
    mat.map = tex
    mat.color.setHex(0xffffff)
  }
  return mat
}
