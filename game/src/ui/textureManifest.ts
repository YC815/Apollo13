/** 貼皮路徑與建議尺寸 — 對應 public/textures/README.md */
const base = import.meta.env.BASE_URL

function tex(subpath: string, w: number, h: number) {
  return { path: `${base}${subpath}`, w, h }
}

export const TEXTURE_MANIFEST = {
  spacecraft: {
    body:          tex('textures/spacecraft/body.png',           1024, 2048),
    shield:        tex('textures/spacecraft/shield.png',         512,  512),
    tunnel:        tex('textures/spacecraft/tunnel.png',         512,  512),
    panel:         tex('textures/spacecraft/panel.png',          1024, 512),
    window:        tex('textures/spacecraft/window.png',         256,  256),
    cabinInterior: tex('textures/spacecraft/cabin-interior.png', 2048, 1024),
  },
  cockpit: {
    instrumentPanel: tex('textures/cockpit/instrument-panel.png', 2048, 1024),
    button:          tex('textures/cockpit/button.png',           128,  64),
    gaugeFace:       tex('textures/cockpit/gauge-face.png',       256,  256),
    frame:           tex('textures/cockpit/frame.png',            512,  1024),
    glass:           tex('textures/cockpit/glass.png',            1024, 768),
  },
  earth: {
    diffuse:    tex('textures/earth/diffuse.png',    2048, 1024),
    atmosphere: tex('textures/earth/atmosphere.png', 2048, 1024),
  },
  stars: {
    skybox:   tex('textures/stars/skybox.png',   4096, 2048),
    particle: tex('textures/stars/particle.png', 64,   64),
  },
} as const
