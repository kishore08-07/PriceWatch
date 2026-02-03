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
        // Copy extension files from public to dist after build
        const filesToCopy = ['manifest.json', 'content.js', 'bg.js'];
        filesToCopy.forEach(file => {
          copyFileSync(
            resolve(__dirname, 'public', file),
            resolve(__dirname, 'dist', file)
          );
        });
        console.log('✓ Extension files copied to dist/');
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        popup: 'popup.html'
      }
    }
  }
})
