import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run phone` serves over HTTPS on your local network, because iOS only
// hands out tilt data to secure pages. Plain `npm run dev` stays on http://localhost.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'phone' ? [basicSsl()] : [],
  server: mode === 'phone' ? { host: true } : {},
}));
