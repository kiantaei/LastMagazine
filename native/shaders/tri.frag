#version 450

layout(location = 0) in vec3 fragColor;
layout(location = 1) in vec3 fragPos;

layout(location = 0) out vec4 outColor;

void main() {
    // Height fog: haze toward the horizon like the web version's fog
    float fog = clamp(length(fragPos) / 9000.0, 0.0, 1.0);
    vec3 haze = vec3(0.66, 0.74, 0.81);
    outColor = vec4(mix(fragColor, haze, fog * fog * 0.85), 1.0);
}
