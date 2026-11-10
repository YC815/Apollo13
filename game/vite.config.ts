/// <reference types="vitest" />
import { defineConfig } from 'vite'

// GitHub Pages 專案站：設 VITE_BASE=/倉庫名/（例 /Apollo13/）
// 本機開發：不設，預設 /
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  test: {
    environment: 'node',
  },
})
