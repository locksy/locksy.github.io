// WebGL Shader Background
var container;
var camera, scene, renderer;
var uniforms;

var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent); // Detect mobile devices

init();
animate();

function init() {
    container = document.getElementById('container');

    camera = new THREE.Camera();
    camera.position.z = 1;

    scene = new THREE.Scene();

    var geometry = new THREE.PlaneBufferGeometry(2, 2);

    uniforms = {
        time: { value: 1.0 },
        resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        mouse: { value: new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2) } // Start at center
    };

    var material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: document.getElementById('vertexShader').textContent,
        fragmentShader: document.getElementById('fragmentShader').textContent
    });

    var mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    renderer = new THREE.WebGLRenderer();
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    onWindowResize();
    window.addEventListener('resize', onWindowResize, false);

    // Mouse interaction for desktops
    if (!isMobile) {
        window.addEventListener('mousemove', onMouseMove, false);
    } else {
        // Add device orientation support for mobile
        requestDeviceOrientationPermission();
    }
}

// Mouse movement interaction (for desktop)
function onMouseMove(event) {
    uniforms.mouse.value.x = event.clientX;
    uniforms.mouse.value.y = renderer.domElement.height - event.clientY;
}

// Device orientation interaction (for mobile)
function handleOrientation(event) {
    const gamma = event.gamma;  // Left-to-right tilt
    const beta = event.beta;    // Front-to-back tilt

    // Map orientation values to the mouse uniform (which drives the visuals)
    uniforms.mouse.value.x = (window.innerWidth / 2) + gamma * 5; // Adjust sensitivity
    uniforms.mouse.value.y = (window.innerHeight / 2) + beta * 5; // Adjust sensitivity
}

// Request permission for iOS (mandatory for sensor data access on iOS devices)
function requestDeviceOrientationPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientation, true);
                }
            })
            .catch(console.error);
    } else {
        // For non-iOS mobile devices, no permission is needed
        window.addEventListener('deviceorientation', handleOrientation, true);
    }
}

// Resize handling
function onWindowResize(event) {
    renderer.setSize(window.innerWidth, window.innerHeight);
    uniforms.resolution.value.x = renderer.domElement.width;
    uniforms.resolution.value.y = renderer.domElement.height;
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    render();
}

// Render loop
function render() {
    uniforms.time.value += 0.05;
    renderer.render(scene, camera);
}
