// Authored for ghostty-web-shaderc, MIT licensed.
void mainImage(out vec4 color, in vec2 fragCoord) {
    ivec2 size = textureSize(iChannel0, 0);
    vec2 uv = fragCoord / vec2(size);
    ivec2 texel = clamp(ivec2(fragCoord), ivec2(0), size - 1);
    vec4 nearest = texelFetch(iChannel0, texel, 0);
    vec4 level = textureLod(iChannel0, uv, 0.0);
    vec4 gradient = textureGrad(iChannel0, uv, dFdx(uv), dFdy(uv));
    color = (nearest + level + gradient) / 3.0;
}
