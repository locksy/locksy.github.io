const canvas = document.getElementById("glCanvas");
const gl = canvas.getContext("webgl");

const pixelRatio = window.devicePixelRatio || 1;
canvas.width = (window.innerWidth * pixelRatio) * 0.9;
canvas.height = (window.innerHeight * pixelRatio) * 0.9;

let mouseX = 0.5, mouseY = 0.5;

canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = (e.clientX - rect.left) / canvas.width;
    mouseY = 1.0 - (e.clientY - rect.top) / canvas.height;
    
    const textMouseX = (e.clientX / window.innerWidth) * 100;
    const textMouseY = (e.clientY / window.innerHeight) * 100;
    
    document.documentElement.style.setProperty('--mouse-x', `${textMouseX}%`);
    document.documentElement.style.setProperty('--mouse-y', `${textMouseY}%`);
});

const vertexShaderSource = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  #ifdef GL_ES
  precision highp float;
  #endif

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec2 u_mouse;

  void main() {
    vec3 c;
    float l, z = u_time;

    vec2 mouse = u_mouse;
    vec2 uv = gl_FragCoord.xy / u_resolution;
    uv -= 0.5;
    uv.x *= u_resolution.x / u_resolution.y;

    float mouseDist = length(uv - (mouse - 0.5));
    float mouseEffect = 0.8 / (mouseDist + 0.1) * 0.3;

    for (int i = 0; i < 3; i++) {
      vec2 p = uv;
      z += 0.1 + mouseEffect;
      l = length(p);
      p += p / l * (tan(z) + 1.0) * abs(tan(l * 9.0 - z * 2.0));
      c[i] = 0.01 / length(abs(mod(p, 1.0) - 0.5));
    }

    vec3 finalColor = c / l;
    finalColor = mix(finalColor, smoothstep(0.0, 1.0, finalColor), 0.1);
    
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);
gl.useProgram(program);

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1, -1, 1, -1, -1, 1, 1, 1
]), gl.STATIC_DRAW);

const positionLocation = gl.getAttribLocation(program, "a_position");
gl.enableVertexAttribArray(positionLocation);
gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

const timeLocation = gl.getUniformLocation(program, "u_time");
const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
const mouseLocation = gl.getUniformLocation(program, "u_mouse");

function render(timestamp) {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform1f(timeLocation, timestamp * 0.001);
  gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
  gl.uniform2f(mouseLocation, mouseX, mouseY);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  requestAnimationFrame(render);
}

window.addEventListener('resize', () => {
  canvas.width = (window.innerWidth * pixelRatio) * 0.9;
  canvas.height = (window.innerHeight * pixelRatio) * 0.9;
});

requestAnimationFrame(render);
