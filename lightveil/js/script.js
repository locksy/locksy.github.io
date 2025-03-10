// Get the canvas and set its size
const canvas = document.getElementById('glCanvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Initialize WebGL context
const gl = canvas.getContext('webgl');
if (!gl) {
  console.error("WebGL not supported or disabled in this browser.");
  alert("WebGL not supported. Please try a different browser.");
}

// Shader source code
const vsSource = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

const fsSource = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform float u_mixFactor;
void main() {
  vec4 color0 = texture2D(u_texture0, v_texCoord);
  vec4 color1 = texture2D(u_texture1, v_texCoord);
  gl_FragColor = mix(color0, color1, u_mixFactor);
}
`;

// Utility: compile a shader from source
function compileShader(gl, source, type) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Shader compile error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
  }
  return shader;
}

// Utility: create a shader program
function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program linking error:", gl.getProgramInfoLog(program));
      return null;
  }
  return program;
}

// Compile shaders and create the program
const vertexShader = compileShader(gl, vsSource, gl.VERTEX_SHADER);
const fragmentShader = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);
const program = createProgram(gl, vertexShader, fragmentShader);

if (!program) {
  console.error("Failed to initialize shader program.");
}

// Define geometry data (a full-screen rectangle)
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
const positions = [
  -1, -1,
   1, -1,
  -1,  1,
  -1,  1,
   1, -1,
   1,  1,
];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

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

// Get attribute and uniform locations
const aPositionLocation = gl.getAttribLocation(program, "a_position");
const aTexCoordLocation = gl.getAttribLocation(program, "a_texCoord");
const uTexture0Location = gl.getUniformLocation(program, "u_texture0");
const uTexture1Location = gl.getUniformLocation(program, "u_texture1");
const uMixFactorLocation = gl.getUniformLocation(program, "u_mixFactor");

// List of image paths
const imagePaths = [
  "img/1.jpg",
  "img/2.jpg",
  "img/3.jpg",
  "img/4.jpg",
  "img/5.jpg",
  "img/6.jpg",
  "img/7.jpg"
];

// Helper function to load an image as a promise
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = url;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image: ' + url));
  });
}

// Load images, create textures, and start animation
Promise.all(imagePaths.map(loadImage)).then(images => {
  const textures = images.map(image => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Flip the Y axis for proper texture orientation
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA,
      gl.UNSIGNED_BYTE, image
    );
    // Set texture filtering
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  });

  let currentIndex = 0;
  let nextIndex = 1;
  let mixFactor = 0;
  const transitionDuration = 2000; // in milliseconds
  let lastTime = performance.now();

  function render(now) {
    const deltaTime = now - lastTime;
    lastTime = now;
    mixFactor += deltaTime / transitionDuration;
    if (mixFactor >= 1) {
      mixFactor = 0;
      currentIndex = nextIndex;
      nextIndex = (nextIndex + 1) % textures.length;
    }

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);

    // Set up position attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(aPositionLocation);
    gl.vertexAttribPointer(aPositionLocation, 2, gl.FLOAT, false, 0, 0);

    // Set up texture coordinate attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.enableVertexAttribArray(aTexCoordLocation);
    gl.vertexAttribPointer(aTexCoordLocation, 2, gl.FLOAT, false, 0, 0);

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures[currentIndex]);
    gl.uniform1i(uTexture0Location, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures[nextIndex]);
    gl.uniform1i(uTexture1Location, 1);

    // Set mix factor uniform
    gl.uniform1f(uMixFactorLocation, mixFactor);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}).catch(error => {
  console.error("Error loading images:", error);
});

// Adjust canvas size on window resize
window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});
