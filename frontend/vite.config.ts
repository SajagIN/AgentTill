import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "path"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      '/missions': 'http://localhost:3000',
      '/approvals': 'http://localhost:3000',
      '/catalog': 'http://localhost:3000',
      '/audit': 'http://localhost:3000',
      '/policies': 'http://localhost:3000',
      '/pay': 'http://localhost:3000',
      '/quote': 'http://localhost:3000',
      '/checkout': 'http://localhost:3000',
      '/negotiate': 'http://localhost:3000',
    }
  }
})
