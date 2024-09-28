let container;
let camera, scene, renderer;
let uniforms;

let loader = new THREE.TextureLoader();
let texture, bg;
loader.setCrossOrigin("anonymous");

// Paths to your texture images (local paths)
const noiseTextureURL = './textures/noise.png';
const bgTextureURL = './textures/clouds-1-tile.jpg';

// Load the textures with error handling
loader.load(
  noiseTextureURL,
  (tex) => {
    texture = tex;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearFilter;
    loader.load(
      bgTextureURL,
      (tex) => {
        bg = tex;
        bg.wrapS = THREE.RepeatWrapping;
        bg.wrapT = THREE.RepeatWrapping;
        bg.minFilter = THREE.LinearFilter;
        console.log('Textures loaded successfully.');
        init();
        animate();
      },
      undefined,
      (err) => {
        console.error('Error loading background texture:', err);
      }
    );
  },
  undefined,
  (err) => {
    console.error('Error loading noise texture:', err);
  }
);

function init() {
  console.log('Initializing scene...');
  container = document.getElementById('container');

  camera = new THREE.Camera();
  camera.position.z = 1;

  scene = new THREE.Scene();

  var geometry = new THREE.PlaneBufferGeometry(2, 2);

  uniforms = {
    u_time: { type: "f", value: 1.0 },
    u_resolution: { type: "v2", value: new THREE.Vector2() },
    u_noise: { type: "t", value: texture },
    u_bg: { type: "t", value: bg },
    u_mouse: { type: "v2", value: new THREE.Vector2() },
    u_scroll: { type: 'f', value: 0 }
  };

  var material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: document.getElementById('vertexShader').textContent,
    fragmentShader: document.getElementById('fragmentShader').textContent
  });
  material.extensions.derivatives = true;

  var mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  renderer = new THREE.WebGLRenderer();
  renderer.setPixelRatio(window.devicePixelRatio);

  container.appendChild(renderer.domElement);

  onWindowResize();
  window.addEventListener('resize', onWindowResize, false);

  // Mouse move event for desktop interaction
  document.addEventListener('pointermove', (e) => {
    let ratio = window.innerHeight / window.innerWidth;
    uniforms.u_mouse.value.x = (e.pageX - window.innerWidth / 2) / window.innerWidth / ratio;
    uniforms.u_mouse.value.y = (e.pageY - window.innerHeight / 2) / window.innerHeight * -1;

    e.preventDefault();
  });

  // Device orientation events for mobile interaction
  initializeDeviceOrientation();
}

function onWindowResize(event) {
  renderer.setSize(window.innerWidth, window.innerHeight);
  uniforms.u_resolution.value.x = renderer.domElement.width;
  uniforms.u_resolution.value.y = renderer.domElement.height;
}

function animate(delta) {
  requestAnimationFrame(animate);
  render(delta);
}

function render(delta) {
  uniforms.u_time.value = -1000 + delta * 0.0005;
  uniforms.u_scroll.value = window.scrollY || window.pageYOffset || 0;
  renderer.render(scene, camera);
}

/* Device Orientation Integration */

// Initialize device orientation handling
function initializeDeviceOrientation() {
  // Check if DeviceOrientationEvent is available
  if (window.DeviceOrientationEvent) {
    // For iOS 13+ devices
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      console.log('DeviceOrientationEvent.requestPermission is available');
      document.getElementById('requestPermissionButton').style.display = 'block';
      document.getElementById('requestPermissionButton').addEventListener('click', function() {
        DeviceOrientationEvent.requestPermission()
          .then(function(response) {
            console.log('DeviceOrientationEvent.requestPermission response:', response);
            if (response === 'granted') {
              document.getElementById('requestPermissionButton').style.display = 'none';
              window.addEventListener('deviceorientation', handleDeviceOrientation);
            } else {
              alert('Permission not granted for Device Orientation');
            }
          })
          .catch(function(error) {
            console.error('Error requesting device orientation permission:', error);
          });
      });
    } else {
      // Non-iOS or older iOS versions
      console.log('DeviceOrientationEvent.requestPermission is not required');
      document.getElementById('requestPermissionButton').style.display = 'none';
      window.addEventListener('deviceorientation', handleDeviceOrientation);
    }
  } else {
    console.log('DeviceOrientationEvent is not supported in your browser.');
    document.getElementById('requestPermissionButton').style.display = 'none';
  }
}

function handleDeviceOrientation(event) {
  console.log('Device orientation event:', event);
  const gamma = event.gamma; // Left to right tilt in degrees, between -90 and 90
  const beta = event.beta;   // Front to back tilt in degrees, between -180 and 180

  // Normalize gamma and beta to values between -1 and 1
  const normalizedGamma = gamma ? gamma / 90 : 0;
  const normalizedBeta = beta ? beta / 180 : 0;

  // Update the u_mouse uniform with the normalized values
  uniforms.u_mouse.value.x = normalizedGamma;
  uniforms.u_mouse.value.y = normalizedBeta;
}
