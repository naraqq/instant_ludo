import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    // Windows-mounted files do not reliably emit filesystem events under WSL.
    watch: { usePolling: Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP), interval: 250 },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/phaser/')) return 'phaser'
          if (id.includes('/node_modules/@colyseus/')) return 'multiplayer'
        },
      },
    },
  },
})
