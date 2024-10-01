#ifdef GL_ES
precision mediump float;
#endif

#extension GL_OES_standard_derivatives : enable

uniform float time;
uniform vec2 mouse;
uniform vec2 resolution;

varying vec2 vUv;

void main(void) {
    vec2 uv = vUv;
    vec2 p = gl_FragCoord.xy / resolution.xy;
    float d = dot(uv, uv);
    float a = atan(uv.y, uv.x);
    vec3 color = vec3(0.0);

    p -= 0.5;
    p.x *= resolution.x / resolution.y;

    float z = time; 
    float l = length(p);

    for (int i = 0; i < 3; i++) {
        uv = p;
        z -= 0.1;
        float dist = distance(gl_FragCoord.xy / resolution.xy, mouse / resolution);
        uv += p / l * (tan(z * 0.1) + log(z)) * abs(sin(l * 5.0 - z * 0.1)) * (1.0 / (dist * 5.0 + 1.0));

        // Original color calculation focused on prismatic effects
        color[i] = 0.0031 / abs(uv.y * uv.x + cos(z * 0.05)) * 2.0 + 0.001 / abs(uv.y * uv.x) * 2.0;
    }

    gl_FragColor = vec4(color / l, 1.0);
}
