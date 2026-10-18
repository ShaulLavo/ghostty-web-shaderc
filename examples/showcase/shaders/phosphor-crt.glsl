// Original example. MIT License, see the repository LICENSE.

vec3 phosphor(vec2 uv) {
    vec2 pixel = 1.0 / iResolution.xy;
    vec3 color = texture(iChannel0, uv).rgb;
    vec3 glow = texture(iChannel0, uv + pixel * vec2(2.0, 0.0)).rgb;
    glow += texture(iChannel0, uv - pixel * vec2(2.0, 0.0)).rgb;
    glow += texture(iChannel0, uv + pixel * vec2(0.0, 2.0)).rgb;
    glow += texture(iChannel0, uv - pixel * vec2(0.0, 2.0)).rgb;
    return color + glow * 0.14;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 centered = uv * 2.0 - 1.0;
    vec2 glass = centered * (1.0 + 0.075 * dot(centered, centered));
    vec2 curved = glass * 0.5 + 0.5;

    float fringe = 1.25 / iResolution.x;
    vec3 color = phosphor(curved);
    color.r = phosphor(curved + vec2(fringe, 0.0)).r;
    color.b = phosphor(curved - vec2(fringe, 0.0)).b;

    float scanline = 0.88 + 0.12 * sin(fragCoord.y * 3.14159265);
    float refresh = 0.98 + 0.02 * sin(iTime * 5.0 + uv.y * 12.0);
    float vignette = 1.0 - 0.22 * dot(centered, centered);
    color *= vec3(0.85, 1.10, 0.96) * scanline * refresh * vignette;

    vec2 edge = min(curved, 1.0 - curved) * iResolution.xy;
    float screen = smoothstep(0.0, 2.0, min(edge.x, edge.y));
    fragColor = vec4(color * screen, 1.0);
}
