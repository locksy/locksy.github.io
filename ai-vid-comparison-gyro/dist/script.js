// Images setup
const images = [
  "./moon.jpg" // Using local image for the test
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

document.addEventListener('DOMContentLoaded', function () {
  // Initialize the slider
  slider = new rgbKineticSlider({
    slideImages: images,
    itemsTitles: texts,
    backgroundDisplacementSprite: './moon.jpg', // Using moon.jpg for displacement as well
    cursorDisplacementSprite: './moon.jpg', // Using moon.jpg for cursor effect
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
    mobileTextSubTitleOffsetTop: 100,
    useGyroscope: true // Enable gyroscope input
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
document.getElementById('grant-gyro-permission').addEventListener('click', function () {
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

  // Inject mouse data into the library directly
  updateSliderDistortion(mouseX, mouseY);
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

  // Inject gyroscope data into the library directly
  updateSliderDistortion(mouseX, mouseY);
}

function updateSliderDistortion(x, y) {
  if (slider && slider.displacementFilter) {
    // Pass the calculated mouse or gyro coordinates to the displacement filter
    slider.displacementFilter.scale.x = (x - window.innerWidth / 2) * 0.05;
    slider.displacementFilter.scale.y = (y - window.innerHeight / 2) * 0.05;
  }
}
