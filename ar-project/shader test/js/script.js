const canvas = document.getElementById("glCanvas");
const gl = canvas.getContext("webgl", { alpha: false, antialias: false });

// Add permission overlay to DOM
document.body.insertAdjacentHTML('beforeend', `
  <div id="permission-overlay">
    <div id="permission-content">
      <div class="permission-text">Enable motion for an interactive experience</div>
      <button id="permission-button">Enable</button>
    </div>
  </div>
`);

function updateCanvasSize() {
    // Get the device pixel ratio
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2x for performance
    
    // Get actual display dimensions
    const displayWidth = Math.floor(canvas.clientWidth * pixelRatio * 0.85);
    const displayHeight = Math.floor(canvas.clientHeight * pixelRatio * 0.85);
    
    // Update canvas size if necessary
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
    }
}

let mouseX = 0.5, mouseY = 0.5;
let isDeviceMotionActive = false;

// Smooth motion parameters
const smoothing = {
    current: { x: 0.5, y: 0.5 },
    target: { x: 0.5, y: 0.5 },
    ease: 0.1
};

[Rest of your existing JavaScript code remains the same until the render function]

function render(timestamp) {
    updateCanvasSize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(timeLocation, timestamp * 0.001);
    gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    gl.uniform2f(mouseLocation, mouseX, mouseY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(render);
}

// Update canvas size on resize
window.addEventListener('resize', updateCanvasSize);

// Initial setup
updateCanvasSize();
requestAnimationFrame(render);
