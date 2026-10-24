import { CLIENT_PROTOCOL_REVISION } from './src/utils/clientProtocol'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { validateApiUrl } from './build-config/api-url'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiUrl = validateApiUrl(env.VITE_API_URL, command === 'build', env.VITE_ALLOW_LOCAL_API === 'true')
  const buildId = env.VITE_BUILD_ID ?? 'development'
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(buildId)) throw new Error('VITE_BUILD_ID must be a public identifier of 1 to 96 safe characters.')
  return {
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl), __WEB_BUILD_ID__: JSON.stringify(buildId) },
    plugins: [
      { name: 'public-release-identity', generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'release.json', source: JSON.stringify({ buildId, protocolRevision: CLIENT_PROTOCOL_REVISION }) })
      } },
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
