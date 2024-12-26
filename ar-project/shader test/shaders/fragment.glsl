#ifdef GL_ES
precision mediump float;
#endif

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;

void main() {
    vec3 c;
    float l, z = u_time;

    // Real-time mouse interactivity
    vec2 mouse = u_mouse / u_resolution;
    vec2 uv = gl_FragCoord.xy / u_resolution;
    uv -= 0.5; // Center UVs
    uv.x *= u_resolution.x / u_resolution.y; // Fix aspect ratio

    float mouseDist = length(uv - (mouse - 0.5));
    float mouseEffect = 0.5 / (mouseDist + 0.2); // Stronger effect

    for (int i = 0; i < 3; i++) {
        vec2 p = uv;
        z += 0.1 + mouseEffect;
        l = length(p);
        p += p / l * (tan(z) + 1.0) * abs(tan(l * 9.0 - z * 2.0));
        c[i] = 0.01 / length(abs(mod(p, 1.0) - 0.5));
    }

    gl_FragColor = vec4(c / l, 1.0);
}
