import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, textures = [], material, mesh;
const imagePaths = Array.from({ length: 7 }, (_, i) => `../img/${i + 1}.jpg`);
let blendFactor = 0.0, currentImageIndex = 0;

function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 2;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    loadTextures();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onWindowResize);
    animate();
}

function loadTextures() {
    const loader = new THREE.TextureLoader();
    imagePaths.forEach(path => {
        loader.load(path, texture => textures.push(texture));
    });
    createMaterial();
}

function createMaterial() {
    if (textures.length < 2) return;
    material = new THREE.ShaderMaterial({
        uniforms: {
            texture1: { value: textures[currentImageIndex] },
            texture2: { value: textures[(currentImageIndex + 1) % textures.length] },
            blendFactor: { value: blendFactor }
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
            uniform float blendFactor;
            varying vec2 vUv;
            void main() {
                vec4 color1 = texture2D(texture1, vUv);
                vec4 color2 = texture2D(texture2, vUv);
                gl_FragColor = mix(color1, color2, blendFactor);
            }
        `,
        transparent: true
    });
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);
}

function onMouseMove(event) {
    blendFactor = event.clientX / window.innerWidth;
    if (material) material.uniforms.blendFactor.value = blendFactor;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

init();
