// Authored for ghostty-web-shaderc, MIT licensed.
#define PI 3.14159265358979323846

vec2 curvedScreen(vec2 uv) {
    vec2 centered = uv * 2.0 - 1.0;
    vec2 bend = centered.yx * centered.yx * 0.025;
    return (centered * (1.0 + bend) + 1.0) * 0.5;
}

float noise(vec2 pixel) {
    return fract(sin(dot(pixel, vec2(12.9898, 78.233)) + iTime) * 43758.5453);
}

void mainImage(out vec4 color, in vec2 fragCoord) {
    vec2 uv = curvedScreen(fragCoord / iResolution.xy);
    vec2 pixel = 1.0 / max(iResolution.xy, vec2(1.0));
    vec4 terminal = texture(iChannel0, uv);
    vec3 phosphor = vec3(
        texture(iChannel0, uv + vec2(pixel.x, 0.0)).r,
        terminal.g,
        texture(iChannel0, uv - vec2(pixel.x, 0.0)).b
    );
    float scanline = 0.85 + 0.15 * sin(fragCoord.y * PI + iTime * 2.0);
    vec2 edge = smoothstep(vec2(0.0), vec2(0.025), uv)
        * (1.0 - smoothstep(vec2(0.975), vec2(1.0), uv));
    vec3 grain = vec3((noise(fragCoord) - 0.5) * 0.015);
    color = vec4(max(phosphor * scanline + grain, vec3(0.0)) * edge.x * edge.y, terminal.a);
}
