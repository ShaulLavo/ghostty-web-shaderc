// Authored for ghostty-web-shaderc, MIT licensed.
#define TAP_COUNT 3
#define WEIGHT(value) ((value) * 0.25)

struct Sample {
    vec3 color;
    float weight;
};

float tone(float value) {
    return value / (1.0 + value);
}

vec3 tone(vec3 value) {
    return value / (vec3(1.0) + value);
}

void accumulate(inout vec3 color, out float luminance, Sample sampleValue) {
    color += sampleValue.color * sampleValue.weight;
    luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void mainImage(out vec4 color, in vec2 fragCoord) {
    int channel = clamp(iFrame % 4, 0, 3);
    float angle = iChannelTime[channel] + iTime * 0.01;
    mat2 rotation = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
    mat3 basis = mat3(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0));
    vec2 uv = rotation * (fragCoord / iResolution.xy - 0.5) + 0.5;
    vec3 taps[TAP_COUNT];
    uint bits = uint(max(iFrame, 0));
    bits = (bits ^ (bits >> 8u)) & 255u;
    vec3 sum = vec3(0.0);
    float luminance = 0.0;
    for (int index = 0; index < TAP_COUNT; index++) {
        taps[index] = texture(iChannel0, uv + vec2(float(index) / iResolution.x, 0.0)).rgb;
        Sample sampleValue = Sample(basis * taps[index], WEIGHT(float(index + 1)));
        accumulate(sum, luminance, sampleValue);
    }
    int index = 0;
    while (index < TAP_COUNT) {
        index++;
        if (index == 2) continue;
        sum += iPalette[(int(bits) + index) % 256] * 0.01;
        if (luminance > 100.0) break;
    }
    vec3 channelSize = iChannelResolution[channel];
    color = vec4(tone(sum) + vec3(tone(luminance) * channelSize.z * 0.01), 1.0);
}
