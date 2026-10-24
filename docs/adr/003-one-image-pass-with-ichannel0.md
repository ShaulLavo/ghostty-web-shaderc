# 003. One image pass with `iChannel0`

Status: accepted
Date: 2026-10-18

## Context

ShaderToy has multipass buffers, extra channels, audio, and video. This package targets a smaller set: one image pass, the terminal texture as `iChannel0`, and the Ghostty uniform names. It ships the compiler and leaves rendering to the application.

## Decision

Support one image pass. The only resources are the Ghostty uniform block (binding 0), the `iChannel0` texture (binding 1), and its sampler (binding 2). The compiler rejects any other resource, input, or output with a contract error. Applications that want several passes compile several shaders and chain them.

## Alternatives considered

- **Full ShaderToy compatibility.** It means a buffer graph, a channel resolution protocol, and audio and video inputs. The package would need a renderer, which `AGENTS.md` keeps separate from the compiler.
- **Open resource declarations.** Authors could declare their own textures and buffers. The two backends would then need a reflection and binding protocol for every shader, and the single uniform ABI would stop working.

## Consequences

A fixed contract means one packed buffer layout, one bind group layout, and a short list of checks. It also means a ShaderToy shader that reads `iChannel1` fails with an unknown variable, and chaining passes is the application's job. The uniform arrays `iChannelTime` and `iChannelResolution` keep four entries, even though only channel 0 exists.
