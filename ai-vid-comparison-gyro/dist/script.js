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

let slider;
let isGyroActive = false;

document.addEventListener('DOMContentLoaded', function() {
  // Initialize the slider
  slider = new rgbKineticSlider({
    slideImages: images,
    itemsTitles: texts,
    backgroundDisplacementSprite: 'https://images.unsplash.com/photo-1558865869-c93f6f8482af?ixlib=rb-1.2.1&auto=format&fit=crop&w=2081&q=80',
    cursorDisplacementSprite: 'https://images.unsplash.com/photo-1558865869-c93f6f8482af?ixlib=rb-1.2.1&auto=format&fit=crop&w=2081&q=80',
    cursorImgEffect: true,
    cursorTextEffect: false,
    cursorScaleIntensity: 0.65,
    cursorMomentum: 0.14,
    swipe: true,
    swipeDistance: window.innerWidth * 0.4,
    swipeScaleIntensity: 2,
    slideTransitionDuration: 1,
    transitionScaleIntensity: 30,
    transitionScaleAmplitude: 160,
    nav: true,
    navElement: '.main-nav',
    textsDisplay: true,
    textsSubTitleDisplay: true,
    textsTiltEffect: true,
    googleFonts: ['Playfair Display:700', 'Roboto:400'],
    buttonMode: false,
    textsRgbEffect: true,
    textsRgbIntensity: 0.03,
    navTextsRgbIntensity: 15,
    textTitleColor: 'white',
    textTitleSize: 80,
    mobileTextTitleSize: 60,
    textTitleLetterspacing: 2,
    textSubTitleColor: 'white',
    textSubTitleSize: 18,
    mobileTextSubTitleSize: 16,
    textSubTitleLetterspacing: 1,
    textSubTitleOffsetTop: 120,
    mobileTextSubTitleOffsetTop: 100
  });

  setupGyroOrMouseControl();
});

function setupGyroOrMouseControl() {
  if (isMobileDevice()) {
    // Show the gyroscope permission button
    document.getElementById('gyro-permission-container').style.display = 'block';
  } else {
    // Desktop: Use mouse movement for distortion
    window.addEventListener('mousemove', handleMouseMove);
  }
}

function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(navigator.userAgent);
}

// Event listener for the gyroscope permission button
document.getElementById('grant-gyro-permission').addEventListener('click', function() {
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(response => {
        if (response === 'granted') {
          startGyroControl();
        } else {
          console.log('Gyroscope permission denied');
        }
        hideGyroPermissionButton();
      })
      .catch(console.error);
  } else {
    startGyroControl();
    hideGyroPermissionButton();
  }
});

function hideGyroPermissionButton() {
  // Hide the permission button after permission is granted or denied
  document.getElementById('gyro-permission-container').style.display = 'none';
}

function startGyroControl() {
  isGyroActive = true;
  window.addEventListener('deviceorientation', handleOrientation);
}

// Handle mouse movement for desktop
function handleMouseMove(event) {
  if (!slider) return;

  const mouseX = event.clientX;
  const mouseY = event.clientY;

  // Calculate positions relative to slider dimensions
  const sliderWidth = window.innerWidth;
  const sliderHeight = window.innerHeight;

  // Update the slider's mouse position based on cursor movement
  slider.mousePosCache.x = mouseX;
  slider.mousePosCache.y = mouseY;
  slider.mousePos.x = mouseX;
  slider.mousePos.y = mouseY;
}

// Handle gyroscope for mobile
function handleOrientation(event) {
  if (!isGyroActive || !slider) return;

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

  // Update the slider's mouse position based on gyroscope movement
  slider.mousePosCache.x = mouseX;
  slider.mousePosCache.y = mouseY;
  slider.mousePos.x = mouseX;
  slider.mousePos.y = mouseY;
}
