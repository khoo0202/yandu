import { defineConfig } from 'vite';

// base './' so the build works under https://<user>.github.io/yandu/
export default defineConfig({
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
