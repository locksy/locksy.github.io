// Images setup
const images = [
  "https://locksy.github.io/ai-vid-comparison/img/dreammachine.jpg",
  "https://images.unsplash.com/photo-1547234935-80c7145ec969?ixlib=rb-1.2.1&auto=format&fit=crop&w=2074&q=80",
  "https://images.unsplash.com/photo-1612892483236-52d32a0e0ac1?ixlib=rb-1.2.1&auto=format&fit=crop&w=2070&q=80",
];

// Content setup
const texts = [
  [
    "Dream Machine",
    "New Features: Luma 1.6 includes a groundbreaking camera control feature with 12 distinct motions.<br>Cost: Free tier offers 30 generations per month, with a $29/month plan for 150 generations."
  ],
  ["Mars", "Surface gravity‎: ‎3.711 m/s²"],
  ["Venus", "Surface gravity‎: ‎8.87 m/s²"],
];

// Declare the slider variable in a scope accessible by the handleOrientation function
let slider;
let isGyroActive = false;

// Initialize the slider
slider = new rgbKineticSlider({
  // ... (existing slider options remain unchanged)
});

function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(navigator.userAgent);
}

window.addEventListener('load', function() {
  if (isMobileDevice()) {
    document.getElementById('permission-modal').style.display = 'flex';
  }
});

document.getElementById('grant-permission').addEventListener('click', function() {
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(response => {
        if (response === 'granted') {
          startGyroControl();
        } else {
          alert('Permission denied. Gyroscope control will not work.');
        }
        document.getElementById('permission-modal').style.display = 'none';
      })
      .catch(console.error);
  } else {
    startGyroControl();
    document.getElementById('permission-modal').style.display = 'none';
  }
});

function startGyroControl() {
  isGyroActive = true;
  window.addEventListener('deviceorientation', handleOrientation);
}

let lastCall = 0;
function handleOrientation(event) {
  if (!isGyroActive) return;

  const now = Date.now();
  if (now - lastCall < 50) return; // Limit to 20fps
  lastCall = now;

  const gamma = event.gamma || 0; // [-90, 90] left-right tilt
  const beta = event.beta || 0;   // [-180, 180] front-back tilt

  // Normalize gamma and beta values
  const normalizedX = (gamma + 90) / 180; // Range: [0, 1]
  const normalizedY = (beta + 180) / 360; // Range: [0, 1]

  // Calculate positions relative to slider dimensions
  const sliderWidth = window.innerWidth;
  const sliderHeight = window.innerHeight;

  const mouseX = normalizedX * sliderWidth;
  const mouseY = normalizedY * sliderHeight;

  // Update the slider's mouse position
  if (slider) {
    slider.mousePosCache.x = mouseX;
    slider.mousePosCache.y = mouseY;
    slider.mousePos.x = mouseX;
    slider.mousePos.y = mouseY;
  }
}

// Add mouse event listeners for non-mobile devices
if (!isMobileDevice()) {
  window.addEventListener('mousemove', handleMouseMove);
}

function handleMouseMove(event) {
  if (slider && !isGyroActive) {
    slider.mousePosCache.x = event.clientX;
    slider.mousePosCache.y = event.clientY;
    slider.mousePos.x = event.clientX;
    slider.mousePos.y = event.clientY;
  }
}