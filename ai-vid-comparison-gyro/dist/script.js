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

// Initialize the slider
slider = new rgbKineticSlider({

  slideImages: images, // Array of images
  itemsTitles: texts,   // Array of titles / subtitles

  backgroundDisplacementSprite: 'https://images.unsplash.com/photo-1558865869-c93f6f8482af?ixlib=rb-1.2.1&auto=format&fit=crop&w=2081&q=80', // Slide displacement image
  cursorDisplacementSprite: 'https://images.unsplash.com/photo-1558865869-c93f6f8482af?ixlib=rb-1.2.1&auto=format&fit=crop&w=2081&q=80', // Cursor displacement image

  cursorImgEffect: true, // Enable cursor effect
  cursorTextEffect: false, // Disable cursor text effect
  cursorScaleIntensity: 0.65, // Cursor effect intensity
  cursorMomentum: 0.14, // Lower is slower

  swipe: true, // Enable swipe
  swipeDistance: window.innerWidth * 0.4, // Swipe distance
  swipeScaleIntensity: 2, // Scale intensity during swiping

  slideTransitionDuration: 1, // Transition duration
  transitionScaleIntensity: 30, // Scale intensity during transition
  transitionScaleAmplitude: 160, // Scale amplitude during transition

  nav: true, // Enable navigation
  navElement: '.main-nav', // Set nav class

  imagesRgbEffect: false, // Disable image RGB effect
  imagesRgbIntensity: 0.9, // Set image RGB intensity
  navImagesRgbIntensity: 80, // Set image RGB intensity for navigation

  textsDisplay: true, // Show title
  textsSubTitleDisplay: true, // Show subtitles
  textsTiltEffect: true, // Enable text tilt
  googleFonts: ['Playfair Display:700', 'Roboto:400'], // Select Google fonts to use
  buttonMode: false, // Disable button mode for title
  textsRgbEffect: true, // Enable text RGB effect
  textsRgbIntensity: 0.03, // Set text RGB intensity
  navTextsRgbIntensity: 15, // Set text RGB intensity for navigation

  textTitleColor: 'white', // Title color
  textTitleSize: 80, // Reduced title size
  mobileTextTitleSize: 60, // Mobile title size
  textTitleLetterspacing: 2, // Title letter spacing

  textSubTitleColor: 'white', // Subtitle color
  textSubTitleSize: 18, // Reduced subtitle size
  mobileTextSubTitleSize: 16, // Mobile subtitle size
  textSubTitleLetterspacing: 1, // Subtitle letter spacing
  textSubTitleOffsetTop: 120, // Increased subtitle offset
  mobileTextSubTitleOffsetTop: 100, // Mobile subtitle offset top
});

// Motion detection code

function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(navigator.userAgent);
}

window.addEventListener('load', function() {
  if (isMobileDevice()) {
    // Check if DeviceOrientationEvent is supported
    if (window.DeviceOrientationEvent) {
      // Show the modal
      document.getElementById('permission-modal').style.display = 'flex';
    }
  }
});

document.getElementById('grant-permission').addEventListener('click', function() {
  // For iOS 13+ devices
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(response => {
        if (response === 'granted') {
          startMotionDetection();
          // Hide the modal
          document.getElementById('permission-modal').style.display = 'none';
        } else {
          alert('Permission denied. Motion detection will not work.');
          document.getElementById('permission-modal').style.display = 'none';
        }
      })
      .catch(error => {
        console.error(error);
        alert('Error requesting permission.');
        document.getElementById('permission-modal').style.display = 'none';
      });
  } else {
    // For devices that don't require permission
    startMotionDetection();
    // Hide the modal
    document.getElementById('permission-modal').style.display = 'none';
  }
});

function startMotionDetection() {
  window.addEventListener('deviceorientation', handleOrientation);
}

let lastCall = 0;
function handleOrientation(event) {
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