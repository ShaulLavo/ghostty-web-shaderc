// Authored for ghostty-web-shaderc, MIT licensed.
float cursorGlow(vec2 pixel, vec4 cursor) {
    vec2 center = cursor.xy + cursor.zw * 0.5;
    vec2 delta = max(abs(pixel - center) - cursor.zw * 0.5, vec2(0.0));
    return 1.0 - smoothstep(0.0, 24.0, length(delta));
}

void mainImage(out vec4 color, in vec2 fragCoord) {
    vec4 terminal = texture(iChannel0, fragCoord / iResolution.xy);
    float elapsed = max(iTime - iTimeCursorChange, 0.0);
    float previous = cursorGlow(fragCoord, iPreviousCursor) * exp(-elapsed * 5.0);
    float current = cursorGlow(fragCoord, iCurrentCursor);
    vec3 glow = iPreviousCursorColor.rgb * previous + iCurrentCursorColor.rgb * current;
    float visible = float(iCursorVisible);
    if (iFocus == 0) visible *= 0.35;
    if (iCurrentCursorStyle == CURSORSTYLE_BAR) glow *= vec3(0.5, 0.75, 1.0);
    float pulse = 0.8 + 0.2 * cos(max(iTime - iTimeFocus, 0.0) * 2.0);
    color = vec4(terminal.rgb + glow * visible * pulse * 0.2, terminal.a);
}
