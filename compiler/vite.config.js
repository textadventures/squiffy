import { resolve } from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/squiffy.ts'),
      name: 'Squiffy',
      fileName: 'compiler',
    },
    rollupOptions: {
      // make sure to externalize deps that shouldn't be bundled
      // into your library
      external: ['jquery','marked','jszip'],
      output: {
        // Provide global variables to use in the UMD build
        // for externalized deps
        globals: {
          marked: 'marked',
        },
      },
    },
  },
  plugins: [dts()]
})