# Bundled shader licenses

All examples are local files. The page does not fetch shaders from GitHub at runtime.
The scanline and pixel grid sources are byte-for-byte copies of the pinned upstream files.
The cursor warp source has one portable adaptation described below.
Their generated WGSL and GLSL output keeps the same upstream licensing terms.

| Local file                 | Author      | Upstream source                                                                                                                                                        | License   |
| -------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `shaders/cursor-warp.glsl` | Sahaj Bhatt | [sahaj-b/cursor-shaders, `ghostty/cursor_warp.glsl`](https://github.com/sahaj-b/cursor-shaders/blob/9ad9158a93c0de0c045e1c6b27df37da698bc8af/ghostty/cursor_warp.glsl) | MIT       |
| `shaders/scanline.glsl`    | zoitrok     | [zoitrok/ghostty-shaders, `shaders/scanline.glsl`](https://github.com/zoitrok/ghostty-shaders/blob/e4d5b433511101539760d0e6bee9ac41d9bcd225/shaders/scanline.glsl)     | Unlicense |
| `shaders/pixels.glsl`      | zoitrok     | [zoitrok/ghostty-shaders, `shaders/pixels.glsl`](https://github.com/zoitrok/ghostty-shaders/blob/e4d5b433511101539760d0e6bee9ac41d9bcd225/shaders/pixels.glsl)         | Unlicense |

The MIT copyright and permission notice is preserved in
[`shaders/sahaj-b.LICENSE.txt`](./shaders/sahaj-b.LICENSE.txt).
The Unlicense text is preserved in
[`shaders/zoitrok.LICENSE.txt`](./shaders/zoitrok.LICENSE.txt).

`shaders/phosphor-crt.glsl` and `shaders/passthrough.glsl` are original examples
distributed under this repository's [MIT license](../../LICENSE).
The CRT example does not use Ghostty's CRT test shader, which has a separate
Creative Commons Attribution-NonCommercial-ShareAlike notice.

## Pinned revisions

- `sahaj-b/cursor-shaders`: `9ad9158a93c0de0c045e1c6b27df37da698bc8af`
- `zoitrok/ghostty-shaders`: `e4d5b433511101539760d0e6bee9ac41d9bcd225`

## Cursor warp adaptation

The upstream `TRAIL_COLOR` global initializes itself from `iCurrentCursorColor`.
Naga 30.2.0 drops this uniform-dependent initializer, leaving the trail transparent.
The bundled copy declares `TRAIL_COLOR` globally and assigns the same original expression
at the start of `mainImage`. Two source comments identify this change. The effect math
and configuration values are unchanged.

Local filenames use hyphens to match the example IDs. The scanline and pixel grid sources
keep their original comments and formatting.
