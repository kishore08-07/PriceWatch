import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync } from 'fs'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-extension-files',
      closeBundle() {
        // Copy manifest.json from public to dist
        copyFileSync(
          resolve(__dirname, 'public', 'manifest.json'),
          resolve(__dirname, 'dist', 'manifest.json')
        );
        console.log('✓ Manifest copied to dist/');
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        popup: 'popup.html',
        content: resolve(__dirname, 'src/content/index.js'),
        background: resolve(__dirname, 'src/background/index.js')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Keep content.js and bg.js as their original names
          if (chunkInfo.name === 'content') return 'content.js';
          if (chunkInfo.name === 'background') return 'bg.js';
          return 'assets/[name]-[hash].js';
        }
      }
    }
  }
})
