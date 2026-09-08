import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// O index.html da raiz é o app já buildado (o Netlify publica o dist/ versionado
// e a raiz guarda uma cópia). Quem aponta para /src/main.jsx é o index.dev.html.
// Sem isto, `npm run dev` serviria o bundle antigo e nenhuma edição em src/
// apareceria na tela. No build, o scripts/build.mjs faz a troca do arquivo.
function useDevHtml() {
  return {
    name: 'comunicapro-dev-html',
    apply: 'serve',
    transformIndexHtml() {
      return readFileSync(new URL('./index.dev.html', import.meta.url), 'utf-8')
    },
  }
}

export default defineConfig({
  plugins: [react(), useDevHtml()],
  resolve: {
    alias: { '@': '/src' }
  }
})
