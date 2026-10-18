import type { Terminal } from 'ghostty-webgpu'

export interface TerminalScene {
  setPaused(paused: boolean): void
  dispose(): void
}

const ESC = '\u001b['
const RESET = `${ESC}0m`
const DIM = `${ESC}38;2;103;123;134m`
const WHITE = `${ESC}38;2;214;232;221m`
const GREEN = `${ESC}38;2;145;236;159m`
const CYAN = `${ESC}38;2;104;211;220m`
const COLORS = ['241;116;117', '245;189;112', '145;236;159', '104;211;220', '167;154;244']
const CURSOR_COLUMNS = [10, 27, 47, 65, 32, 57]

function line(text = ''): string {
  return `${text}${RESET}\r\n`
}

function initialScene(): string {
  return (
    `${ESC}2J${ESC}H${ESC}?25h` +
    line(`${DIM} ghostty@shader-lab ${WHITE}~/signal`) +
    line() +
    line(`${GREEN} ❯ ${WHITE}bun run signal.ts`) +
    line() +
    line(`${GREEN}     ██████╗ ██╗  ██╗ ██████╗ ███████╗████████╗██╗   ██╗`) +
    line(`${GREEN}    ██╔════╝ ██║  ██║██╔═══██╗██╔════╝╚══██╔══╝╚██╗ ██╔╝`) +
    line(`${GREEN}    ██║  ███╗███████║██║   ██║███████╗   ██║    ╚████╔╝ `) +
    line(`${GREEN}    ██║   ██║██╔══██║██║   ██║╚════██║   ██║     ╚██╔╝  `) +
    line(`${GREEN}    ╚██████╔╝██║  ██║╚██████╔╝███████║   ██║      ██║   `) +
    line(`${GREEN}     ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝   ╚═╝      ╚═╝   `) +
    line() +
    line(`${DIM}    REAL TERMINAL. REAL PIXELS. YOUR SHADER.`) +
    line(`    ${COLORS.map((color) => `${ESC}48;2;${color}m        `).join('')}${RESET}`) +
    line() +
    line(`${CYAN}    ✓ ${WHITE}Ghostty WASM       ${DIM}terminal engine ready`) +
    line(`${CYAN}    ✓ ${WHITE}ShaderToy GLSL     ${DIM}compiled in this browser`) +
    line(`${CYAN}    ✓ ${WHITE}WebGPU / WebGL2    ${DIM}one source, two outputs`) +
    line(`${DIM}    ──────────────────────────────────────────────────────`) +
    line(`${GREEN} ❯ ${WHITE}signal ${DIM}────────────────────────────────────────────────────`) +
    line() +
    `${DIM}    Demo session · no server or shell connection${RESET}`
  )
}

export function createTerminalScene(terminal: Terminal): TerminalScene {
  let timer: ReturnType<typeof setInterval> | undefined
  let tick = 0
  let disposed = false
  terminal.write(initialScene())

  function advance(): void {
    tick += 1
    const column = CURSOR_COLUMNS[tick % CURSOR_COLUMNS.length] ?? 10
    const elapsed = (tick * 0.8).toFixed(1).padStart(5, ' ')
    terminal.write(
      `${ESC}21;1H${ESC}2K${DIM}    Demo session · signal active ${elapsed}s${RESET}` +
        `${ESC}19;${column}H`,
    )
  }

  function stop(): void {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  advance()
  return {
    setPaused(paused): void {
      stop()
      if (!paused && !disposed) timer = setInterval(advance, 800)
    },
    dispose(): void {
      disposed = true
      stop()
    },
  }
}
