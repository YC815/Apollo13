import { startLoop, toggleDevice, setO2Held, doReset } from './game/loop'
import { setupControls } from './ui/controls'
import { setupViewControls } from './ui/viewControls'
import { initScene3d } from './ui/scene3d'
import { applyCockpitTextures } from './ui/hudLayout'
import { TEXTURE_MANIFEST } from './ui/textureManifest'
import { loadTexture } from './ui/textures'
import { initBgm } from './ui/bgm'

async function boot(): Promise<void> {
  initBgm()
  const canvasContainer = document.getElementById('canvas-container')!
  await initScene3d(canvasContainer)

  const [instrumentPanel, button, gaugeFace] = await Promise.all([
    loadTexture(TEXTURE_MANIFEST.cockpit.instrumentPanel.path),
    loadTexture(TEXTURE_MANIFEST.cockpit.button.path),
    loadTexture(TEXTURE_MANIFEST.cockpit.gaugeFace.path),
  ])
  applyCockpitTextures({
    instrumentPanel: instrumentPanel ? TEXTURE_MANIFEST.cockpit.instrumentPanel.path : null,
    button: button ? TEXTURE_MANIFEST.cockpit.button.path : null,
    gaugeFace: gaugeFace ? TEXTURE_MANIFEST.cockpit.gaugeFace.path : null,
  })

  setupViewControls()
  setupControls({ toggleDevice, setO2Held, doReset })
  startLoop()
}

boot()
