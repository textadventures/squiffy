import './style.css'
import typescriptLogo from './typescript.svg'
import appLogo from '/favicon.svg'
import { setupCounter } from './counter.ts'
import { initPWA } from './pwa.ts'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div>
    <a href="https://vitejs.dev" target="_blank">
      <img src="${appLogo}" class="logo" alt="App logo" />
    </a>
    <a href="https://www.typescriptlang.org/" target="_blank">
      <img src="${typescriptLogo}" class="logo vanilla" alt="TypeScript logo" />
    </a>
    <h1>Squiffy</h1>
    <div class="card">
      <button id="counter" type="button"></button>
    </div>
    <p class="read-the-docs">
      Click on the Vite and TypeScript logos to learn more
    </p>
  </div>
  <div
    id="pwa-toast"
    role="alert"
    aria-labelledby="toast-message"
  >
    <div class="message">
      <span id="toast-message"></span>
    </div>
    <div class="buttons">
        <button id="pwa-refresh" type="button">
          Reload
        </button>
        <button id="pwa-close" type="button">
          Close
        </button>
    </div>
  </div>
`

setupCounter(document.querySelector<HTMLButtonElement>('#counter')!)

initPWA(app)
