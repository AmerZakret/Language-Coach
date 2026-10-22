import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { validateApiUrl } from './build-config/api-url'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiUrl = validateApiUrl(env.VITE_API_URL, command === 'build', env.VITE_ALLOW_LOCAL_API === 'true')
  return {
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl) },
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  }
})
