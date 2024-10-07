// Vertex shader program
const vertexShaderSource = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;

  void main() {
    gl_Position = vec4(a_position, 0, 1);
    v_texCoord = a_texCoord;
  }
`;

// Fragment shader program
const fragmentShaderSource = `
  precision mediump float;

  varying vec2 v_texCoord;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform vec2 u_mouse;
  uniform float u_time;

  void main() {
    vec2 uv = v_texCoord;

    // Calculate distortion effect
    float dist = distance(u_mouse, uv * u_resolution) / u_resolution.y;
    float strength = 0.2 * sin(u_time + dist * 10.0);
    uv.y += strength * (uv.x - 0.5);

    // Get image color
    vec4 color = texture2D(u_image, uv);

    gl_FragColor = color;
  }
`;

// Utility function to create a shader
function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Error compiling shader:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

// Utility function to create a program
function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Error linking program:', gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

// Get canvas and WebGL context
const canvas = document.querySelector('canvas');
const gl = canvas.getContext('webgl');
if (!gl) {
  console.error('WebGL not supported');
}

// Set canvas size
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Create shaders and program
const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
const program = createProgram(gl, vertexShader, fragmentShader);

// Get attribute and uniform locations
const positionLocation = gl.getAttribLocation(program, 'a_position');
const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
const mouseLocation = gl.getUniformLocation(program, 'u_mouse');
const timeLocation = gl.getUniformLocation(program, 'u_time');
const imageLocation = gl.getUniformLocation(program, 'u_image');

// Set up geometry (two triangles to form a rectangle)
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
const positions = [
  -1, -1,
  1, -1,
  -1, 1,
  -1, 1,
  1, -1,
  1, 1,
];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

// Set up texture coordinates
const texCoordBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
const texCoords = [
  0, 0,
  1, 0,
  0, 1,
  0, 1,
  1, 0,
  1, 1,
];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);

// Load and create the image texture
const image = new Image();
image.src = './moon.jpg';  // Replace with your actual image path
image.onload = function () {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);

  requestAnimationFrame(drawScene);
};

// Variables for mouse and gyroscope
let mouseX = canvas.width / 2;
let mouseY = canvas.height / 2;

// Handle mouse movement
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = rect.bottom - e.clientY;  // Invert Y for WebGL coordinate system
});

// Handle gyroscope for mobile devices
if (window.DeviceOrientationEvent) {
  window.addEventListener('deviceorientation', (event) => {
    const { beta, gamma } = event;  // Beta is for front-to-back tilt, gamma is for left-to-right
    mouseX = (gamma / 90) * canvas.width / 2 + canvas.width / 2;
    mouseY = (beta / 180) * canvas.height / 2 + canvas.height / 2;
  });
}

// Function to draw the scene
function drawScene(time) {
  time *= 0.001;  // Convert time to seconds

  // Resize canvas and viewport
  if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  // Clear canvas
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Use the program
  gl.useProgram(program);

  // Set resolution uniform
  gl.uniform2f(resolutionLocation, canvas.width, canvas.height);

  // Set time uniform
  gl.uniform1f(timeLocation, time);

  // Set mouse uniform
  gl.uniform2f(mouseLocation, mouseX, mouseY);

  // Set up position attribute
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  // Set up texture coordinate attribute
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.enableVertexAttribArray(texCoordLocation);
  gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

  // Bind the texture and set the uniform
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, image);
  gl.uniform1i(imageLocation, 0);

  // Draw the geometry
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Call drawScene again on the next frame
  requestAnimationFrame(drawScene);
}

