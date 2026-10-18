import type { Terminal } from 'ghostty-webgpu'

export interface TerminalScene {
  setPaused(paused: boolean): void
  dispose(): void
}

const ESC = '\u001b['
const RESET = `${ESC}0m`
const WHITE = `${ESC}38;2;214;232;221m`
const GREEN = `${ESC}38;2;145;236;159m`
const COLORS = ['241;116;117', '245;189;112', '145;236;159', '104;211;220', '167;154;244']
const COMMANDS = ['echo', 'echo hello,', 'echo hello, shader', 'echo hello,']
const PROMPT_ROW = 11

function line(text = ''): string {
  return `${text}${RESET}\r\n`
}

function initialScene(): string {
  return (
    `${ESC}2J${ESC}H${ESC}?25h` +
    line() +
    line(`${GREEN}     ██████╗ ██╗  ██╗ ██████╗ ███████╗████████╗██╗   ██╗`) +
    line(`${GREEN}    ██╔════╝ ██║  ██║██╔═══██╗██╔════╝╚══██╔══╝╚██╗ ██╔╝`) +
    line(`${GREEN}    ██║  ███╗███████║██║   ██║███████╗   ██║    ╚████╔╝ `) +
    line(`${GREEN}    ██║   ██║██╔══██║██║   ██║╚════██║   ██║     ╚██╔╝  `) +
    line(`${GREEN}    ╚██████╔╝██║  ██║╚██████╔╝███████║   ██║      ██║   `) +
    line(`${GREEN}     ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝   ╚═╝      ╚═╝   `) +
    line() +
    line(`    ${COLORS.map((color) => `${ESC}48;2;${color}m        `).join('')}${RESET}`) +
    line() +
    `${GREEN} ❯ ${WHITE}echo hello, shader${RESET}`
  )
}

export function createTerminalScene(terminal: Terminal): TerminalScene {
  let timer: ReturnType<typeof setInterval> | undefined
  let tick = 0
  let disposed = false
  terminal.write(initialScene())

  function advance(): void {
    const command = COMMANDS[tick % COMMANDS.length] ?? 'echo'
    tick += 1
    terminal.write(`${ESC}${PROMPT_ROW};1H${ESC}2K${GREEN} ❯ ${WHITE}${command}${RESET}`)
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
