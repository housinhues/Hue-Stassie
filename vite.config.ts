import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vercel serves the app at the domain root. GitHub Pages serves it under the
// repository slug, so keep both deployment targets working from one build.
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/hue-stassie/' : '/',
});
