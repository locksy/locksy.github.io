const canvas = document.getElementById("glCanvas");
const gl = canvas.getContext("webgl");

// Add permission overlay to DOM
document.body.insertAdjacentHTML('beforeend', `
  <div id="permission-overlay">
    <div id="permission-content">
      <div class="permission-text">Enable motion for an interactive experience</div>
      <button id="permission-button">Enable</button>
    </div>
  </div>
`);

const pixelRatio = window.devicePixelRatio || 1;
canvas.width = (window.innerWidth * pixelRatio) * 0.85;
canvas.height = (window.innerHeight * pixelRatio) * 0.85;

let mouseX = 0.5, mouseY = 0.5;
let isDeviceMotionActive = false;

// Smooth motion parameters
const smoothing = {
    current: { x: 0.5, y: 0.5 },
    target: { x: 0.5, y: 0.5 },
    ease: 0.1
};

async function requestDeviceMotionPermission() {
    const overlay = document.getElementById('permission-overlay');
    overlay.classList.remove('visible');
    
    if (typeof DeviceOrientationEvent !== 'undefined' && 
        typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const permissionState = await DeviceOrientationEvent.requestPermission();
            if (permissionState === 'granted') {
                enableDeviceMotion();
            }
        } catch (error) {
            console.error('Error requesting device motion permission:', error);
        }
    } else {
        enableDeviceMotion();
    }
}

function enableDeviceMotion() {
    if ('DeviceOrientationEvent' in window) {
        window.addEventListener('deviceorientation', handleDeviceOrientation);
        isDeviceMotionActive = true;
    }
}

function handleDeviceOrientation(event) {
    const sensitivity = 1.5;
    
    let x = ((event.gamma || 0) + 90) / 180;
    let y = ((event.beta || 0) + 180) / 360;
    
    x = 0.5 + (x - 0.5) * sensitivity;
    y = 0.5 + (y - 0.5) * sensitivity;
    
    smoothing.target.x = Math.max(0, Math.min(1, x));
    smoothing.target.y = Math.max(0, Math.min(1, y));
}

function updateMotionSmoothing() {
    if (isDeviceMotionActive) {
        smoothing.current.x += (smoothing.target.x - smoothing.current.x) * smoothing.ease;
        smoothing.current.y += (smoothing.target.y - smoothing.current.y) * smoothing.ease;
        
        mouseX = smoothing.current.x;
        mouseY = smoothing.current.y;
        
        const textMouseX = mouseX * 100;
        const textMouseY = mouseY * 100;
        
        document.documentElement.style.setProperty('--mouse-x', `${textMouseX}%`);
        document.documentElement.style.setProperty('--mouse-y', `${textMouseY}%`);
    }
    
    requestAnimationFrame(updateMotionSmoothing);
}

canvas.addEventListener("mousemove", (e) => {
    if (!isDeviceMotionActive) {
        const rect = canvas.getBoundingClientRect();
        mouseX = (e.clientX - rect.left) / canvas.width;
        mouseY = 1.0 - (e.clientY - rect.top) / canvas.height;
        
        const textMouseX = (e.clientX / window.innerWidth) * 100;
        const textMouseY = (e.clientY / window.innerHeight) * 100;
        
        document.documentElement.style.setProperty('--mouse-x', `${textMouseX}%`);
        document.documentElement.style.setProperty('--mouse-y', `${textMouseY}%`);
    }
});

function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Initialize permissions UI if on mobile
if (isMobile()) {
    const overlay = document.getElementById('permission-overlay');
    const button = document.getElementById('permission-button');
    
    overlay.classList.add('visible');
    button.addEventListener('click', requestDeviceMotionPermission);
}

// Start motion smoothing
updateMotionSmoothing();

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
  canvas.width = (window.innerWidth * pixelRatio) * 0.85;
  canvas.height = (window.innerHeight * pixelRatio) * 0.85;
});

requestAnimationFrame(render);