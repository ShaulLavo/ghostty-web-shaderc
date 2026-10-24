import { readFile, writeFile } from 'node:fs/promises'
import { SHADER_UNIFORM_BYTE_LENGTH, SHADER_UNIFORM_FIELDS } from '../src/runtime.js'

const path = new URL('../docs/reference/uniforms.md', import.meta.url)
const header = ['Name', 'Shader type', 'Offset', 'Element stride']
const cells = SHADER_UNIFORM_FIELDS.map((field) => {
  const suffix = field.count === 1 ? '' : `[${field.count}]`
  return [
    `\`${field.name}\``,
    `\`${field.type}${suffix}\``,
    String(field.offset),
    String(field.stride),
  ]
})
const widths = header.map((name, index) =>
  Math.max(name.length, ...cells.map((row) => row[index]?.length ?? 0)),
)
const rowText = (row: readonly string[]) =>
  `| ${row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join(' | ')} |`
const table = [rowText(header), rowText(widths.map((width) => '-'.repeat(width)))].concat(
  cells.map(rowText),
)

const meaningGroups: readonly {
  readonly title: string
  readonly intro?: readonly string[]
  readonly rows: readonly (readonly [string, string])[]
}[] = [
  {
    title: 'Viewport and channel',
    rows: [
      [
        'iResolution',
        'Output size in physical pixels: `x` is width, `y` is height. `z` defaults to 1 and the showcase always sends 1. `fragCoord` is the UV multiplied by `iResolution.xy`.',
      ],
      [
        'iChannelResolution',
        'Size of each input texture in pixels, as `(width, height, 1)`. Only index 0 describes `iChannel0`. The showcase sends the terminal texture size at index 0 and zeros for indexes 1 to 3.',
      ],
      [
        'iChannelTime',
        'Playback time of each channel in seconds. Only index 0 matters because only `iChannel0` exists. The showcase sends `iTime` at index 0.',
      ],
    ],
  },
  {
    title: 'Time',
    rows: [
      [
        'iTime',
        'Seconds since the animation started. The application owns the clock. The showcase pauses it when animation pauses.',
      ],
      ['iTimeDelta', 'Seconds between the previous drawn frame and this one.'],
      [
        'iFrameRate',
        'Frames per second. The showcase sends `1 / iTimeDelta`, or 0 when the delta is 0.',
      ],
      [
        'iFrame',
        'Frame counter, a signed 32-bit integer. The showcase starts at 0 and adds 1 per drawn frame.',
      ],
    ],
  },
  {
    title: 'Pointer, date, and audio',
    intro: [
      'The package gives these three no meaning beyond their type. No shader, example, or test in this repository reads or sets them, so the application decides what they hold.',
    ],
    rows: [
      ['iMouse', 'Four floats the application defines.'],
      ['iDate', 'Four floats the application defines.'],
      ['iSampleRate', 'One float the application defines. Audio inputs are not supported.'],
    ],
  },
  {
    title: 'Cursor',
    intro: [
      '`iCurrentCursor` and `iPreviousCursor` are `vec4(x, y, width, height)` in the same pixel space as `fragCoord`: origin at the bottom left, y pointing up.',
      '`x` and `y` locate the top left corner of the cursor rectangle, so the rectangle covers `y - height` to `y` vertically.',
      'The showcase computes them from the terminal cell: `x = column * cellWidth`, `y = outputHeight - row * cellHeight`, with the cell size as width and height. The compiler does not read any of this. The application decides what the numbers mean.',
    ],
    rows: [
      ['iCurrentCursor', 'Cursor rectangle now.'],
      [
        'iPreviousCursor',
        'Cursor rectangle before the latest move. The showcase copies the current value here when the cursor moves.',
      ],
      [
        'iCurrentCursorColor',
        'Cursor color now, normalized RGBA. The showcase sends `(0.57, 0.93, 0.62, 1)`.',
      ],
      ['iPreviousCursorColor', 'Cursor color before the latest change, normalized RGBA.'],
      [
        'iCurrentCursorStyle',
        'Cursor style now. One of the `CURSORSTYLE_*` constants below. The value 0 is `CURSORSTYLE_BLOCK`, so an omitted value reads as a block.',
      ],
      ['iPreviousCursorStyle', 'Cursor style before the latest change.'],
      [
        'iCursorVisible',
        '1 when the cursor is visible, 0 when it is hidden. The showcase reads it from the terminal state.',
      ],
      [
        'iTimeCursorChange',
        'The `iTime` value when the cursor last moved. Shaders here use `iTime - iTimeCursorChange` as the time since the move.',
      ],
    ],
  },
  {
    title: 'Focus',
    rows: [
      ['iFocus', '1 when the terminal has focus, 0 when it does not.'],
      [
        'iTimeFocus',
        'The `iTime` value when focus last changed. Shaders here use `iTime - iTimeFocus` as the time since the change.',
      ],
    ],
  },
  {
    title: 'Colors',
    intro: ['Every color is normalized RGB in the range 0 to 1, not 0 to 255.'],
    rows: [
      [
        'iPalette',
        'The 256-color terminal palette, indexed by palette number. Supply all 256 entries when a shader reads it.',
      ],
      ['iBackgroundColor', 'Terminal background.'],
      ['iForegroundColor', 'Terminal foreground.'],
      ['iCursorColor', 'Cursor color. The showcase takes it from the terminal theme.'],
      ['iCursorText', 'Color of the text under the cursor.'],
      ['iSelectionForegroundColor', 'Selected text color.'],
      ['iSelectionBackgroundColor', 'Selection background.'],
    ],
  },
]

const cursorStyles = [
  ['CURSORSTYLE_BLOCK', '0'],
  ['CURSORSTYLE_BLOCK_HOLLOW', '1'],
  ['CURSORSTYLE_BAR', '2'],
  ['CURSORSTYLE_UNDERLINE', '3'],
  ['CURSORSTYLE_LOCK', '4'],
]

function markdownTable(header: readonly string[], cells: readonly (readonly string[])[]): string[] {
  const widths = header.map((name, index) =>
    Math.max(name.length, ...cells.map((row) => row[index]?.length ?? 0)),
  )
  const rowText = (row: readonly string[]) =>
    `| ${row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join(' | ')} |`
  return [rowText(header), rowText(widths.map((width) => '-'.repeat(width)))].concat(
    cells.map(rowText),
  )
}

const documented = meaningGroups.flatMap((group) => group.rows.map(([name]) => name))
const fieldNames = SHADER_UNIFORM_FIELDS.map((field) => field.name)
if (
  documented.length !== fieldNames.length ||
  fieldNames.some((name) => !documented.includes(name))
) {
  throw new Error('Every uniform needs exactly one meaning in scripts/uniform-reference.ts')
}

const meanings = meaningGroups.flatMap((group) => [
  `### ${group.title}`,
  '',
  ...(group.intro ?? []).flatMap((line) => [line, '']),
  ...markdownTable(
    ['Name', 'Meaning'],
    group.rows.map(([name, meaning]) => [`\`${name}\``, meaning]),
  ),
  '',
])

const text = [
  '# Uniform layout',
  '',
  'Generated by `bun scripts/uniform-reference.ts`. Offsets and strides are in bytes.',
  `The shared std140 buffer occupies ${SHADER_UNIFORM_BYTE_LENGTH} bytes.`,
  '',
]
  .concat(table, [
    '',
    '`packShaderUniforms(values, output?)` packs this layout for both renderers.',
    'Values use the GLSL names above. Omitted values are zero, except `iResolution.z`, which defaults to one.',
    'The optional output must be an ArrayBuffer of exactly the size above. Reuse resets all omitted fields.',
    '',
    'Supply normalized RGB colors and a full 256-entry palette when your shader reads the palette.',
    'Times use seconds. The application supplies resolution, cursor positions, focus, animation timing,',
    'and channel metadata. The compiler does not read application or terminal state.',
    '',
    'Scalar arrays use padded vec4 storage internally. Shader source still sees `float iChannelTime[4]`.',
    '',
    '## What each uniform means',
    '',
    'The compiler only defines the layout. The application supplies every value, and the meanings below are the conventions the showcase and the shaders in this repository follow.',
    '',
    ...meanings,
    '### Cursor style constants',
    '',
    'Every compiled shader defines these macros, so a shader can compare `iCurrentCursorStyle` against them.',
    '',
    ...markdownTable(
      ['Constant', 'Value'],
      cursorStyles.map(([name, value]) => [`\`${name}\``, value ?? '']),
    ),
    '',
  ])
  .join('\n')

if (process.argv.includes('--check')) {
  if ((await readFile(path, 'utf8')) !== text)
    throw new Error('Run bun scripts/uniform-reference.ts')
} else {
  await writeFile(path, text)
}
