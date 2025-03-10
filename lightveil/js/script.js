// LightVeil - Interactive Image Transitions
// Main script for handling WebGL transitions using Three.js

// Configuration
const CONFIG = {
    totalImages: 7,                      // Total number of images to load
    transitionSpeed: 0.1,                // Speed of transition between images (lower = smoother but slower)
    imagePath: '../img/',                // Path to the images folder
    imageFormat: '.jpg',                 // Image file format
    preloadAll: true                     // Whether to preload all images at start
};

// Global variables
let camera, scene, renderer;
let currentImageIndex = 0;
let nextImageIndex = 1;
let transitionMesh;
let transitionMaterial;
let mouseX = 0;
let mouseY = 0;
let targetTransition = 0;
let currentTransition = 0;
let textures = [];
let imagesLoaded = 0;
let isTransitioning = false;

// Initialize the application
function init() {
    // Create renderer
    renderer = new THREE.WebGLRenderer();
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Create scene and camera
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(
        -1, 1, 1, -1, 0, 1
    );

    // Load textures
    loadTextures();

    // Setup event listeners
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('mousemove', onMouseMove);

    // Start animation loop
    animate();
}

// Load all image textures
function loadTextures() {
    const loader = new THREE.TextureLoader();
    
    // Function to handle each loaded texture
    const onTextureLoaded = (index, texture) => {
        console.log(`Loaded image ${index}`);
        textures[index] = texture;
        imagesLoaded++;
        
        // Initialize the transition when we have at least two images
        if (imagesLoaded >= 2 && !transitionMesh) {
            initializeTransition();
        }
        
        // Continue loading if we haven't loaded all images
        if (CONFIG.preloadAll && imagesLoaded < CONFIG.totalImages) {
            loadNextTexture(imagesLoaded);
        }
    };
    
    // Function to load a specific texture
    const loadNextTexture = (index) => {
        const imageIndex = index + 1; // Images are named 1.jpg, 2.jpg, etc.
        const imagePath = CONFIG.imagePath + imageIndex + CONFIG.imageFormat;
        
        loader.load(
            imagePath,
            (texture) => onTextureLoaded(index, texture),
            undefined, // Progress callback
            (err) => console.error(`Error loading texture ${imageIndex}:`, err)
        );
    };
    
    // Start loading first two textures
    loadNextTexture(0);
    loadNextTexture(1);
}

// Initialize the transition mesh and material with shader
function initializeTransition() {
    // Create shader material
    transitionMaterial = new THREE.ShaderMaterial({
        uniforms: {
            texture1: { value: textures[0] },
            texture2: { value: textures[1] },
            mixRatio: { value: 0.0 }
        },
        vertexShader: `
            varying vec2 vUv;
            
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D texture1;
            uniform sampler2D texture2;
            uniform float mixRatio;
            
            varying vec2 vUv;
            
            void main() {
                // Sample both textures
                vec4 color1 = texture2D(texture1, vUv);
                vec4 color2 = texture2D(texture2, vUv);
                
                // Mix the colors based on the mix ratio
                gl_FragColor = mix(color1, color2, mixRatio);
            }
        `
    });

    // Create a plane that fills the screen
    const geometry = new THREE.PlaneBufferGeometry(2, 2);
    transitionMesh = new THREE.Mesh(geometry, transitionMaterial);
    scene.add(transitionMesh);
}

// Handle mouse movement
function onMouseMove(event) {
    // Calculate normalized mouse position (0 to 1)
    mouseX = event.clientX / window.innerWidth;
    
    // Calculate target transition value based on mouse X position
    targetTransition = mouseX * (CONFIG.totalImages - 1);
    
    // Determine which two images we're between
    updateImageIndices();
}

// Update which images we're transitioning between
function updateImageIndices() {
    // Calculate the current image index based on transition value
    currentImageIndex = Math.floor(targetTransition);
    nextImageIndex = (currentImageIndex + 1) % CONFIG.totalImages;
    
    // Ensure the next image is loaded if we haven't preloaded all
    if (!CONFIG.preloadAll && !textures[nextImageIndex] && nextImageIndex < CONFIG.totalImages) {
        const loader = new THREE.TextureLoader();
        const imagePath = CONFIG.imagePath + (nextImageIndex + 1) + CONFIG.imageFormat;
        
        loader.load(
            imagePath,
            (texture) => {
                textures[nextImageIndex] = texture;
                imagesLoaded = Math.max(imagesLoaded, nextImageIndex + 1);
            },
            undefined,
            (err) => console.error(`Error loading texture ${nextImageIndex + 1}:`, err)
        );
    }
}

// Handle window resize
function onWindowResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    
    // Smoothly update current transition value
    currentTransition += (targetTransition - currentTransition) * CONFIG.transitionSpeed;
    
    // Update which images we're between if the transition value has changed significantly
    if (Math.abs(Math.floor(currentTransition) - Math.floor(targetTransition)) > 0) {
        updateImageIndices();
    }
    
    // Update shader uniforms if we have a transition mesh
    if (transitionMesh && textures[currentImageIndex] && textures[nextImageIndex]) {
        // Update textures
        transitionMaterial.uniforms.texture1.value = textures[currentImageIndex];
        transitionMaterial.uniforms.texture2.value = textures[nextImageIndex];
        
        // Calculate mix ratio (fractional part of the transition value)
        const mixRatio = currentTransition - Math.floor(currentTransition);
        transitionMaterial.uniforms.mixRatio.value = mixRatio;
    }
    
    // Render the scene
    renderer.render(scene, camera);
}

// Start initialization when the DOM is loaded
document.addEventListener('DOMContentLoaded', init);
