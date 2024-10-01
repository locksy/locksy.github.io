// WebGL Shader Background
var container;
var camera, scene, renderer;
var uniforms;

var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

init();
animate();

// Function to request device orientation access on iOS
function requestDeviceOrientationPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientation);
                }
            })
            .catch(console.error);
    } else {
        // Handle non-iOS devices
        window.addEventListener('deviceorientation', handleOrientation);
    }
}

// Initialize WebGL and shaders
function init() {
    container = document.getElementById('container');

    camera = new THREE.Camera();
    camera.position.z = 1;

    scene = new THREE.Scene();

    var geometry = new THREE.PlaneBufferGeometry(2, 2);

    uniforms = {
        time: { value: 1.0 },
        resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        mouse: { value: new THREE.Vector2() }
    };

    fetchShaders().then(shaders => {
        var material = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: shaders.vertexShader,
            fragmentShader: shaders.fragmentShader
        });

        var mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        renderer = new THREE.WebGLRenderer();
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        container.appendChild(renderer.domElement);

        onWindowResize();
        window.addEventListener('resize', onWindowResize, false);

        if (isMobile) {
            document.body.addEventListener('click', requestDeviceOrientationPermission, { once: true });
        } else {
            window.addEventListener('mousemove', onMouseMove, false);
        }
    }).catch((error) => {
        console.error('Error loading shaders:', error);
    });
}

// Fetch shaders from external files with error handling
async function fetchShaders() {
    try {
        const vertexShader = await fetch('./shaders/vertexShader.glsl').then(response => {
            if (!response.ok) throw new Error(`Vertex shader failed to load: ${response.statusText}`);
            return response.text();
        });
        const fragmentShader = await fetch('./shaders/fragmentShader.glsl').then(response => {
            if (!response.ok) throw new Error(`Fragment shader failed to load: ${response.statusText}`);
            return response.text();
        });
        return { ve
