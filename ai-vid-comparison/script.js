// images setup
const images = [
  "./img/kling.jpg",     // Background image for Kling
  "./img/dreammachine.jpg", // Background image for Dream Machine
  "./img/haiper.jpg",    // Background image for Haiper
  "./img/pixverse.jpg",  // Background image for Pixverse
];

// content setup
const texts = [
  ["Kling", "Advanced Controls: Kling brings advanced options, like adjusting the aspect ratio, defining camera movements, and even using negative prompts to exclude elements you don’t want in the final output. Text to Video: Kling's generations look dynamic and give off a live-action vibe. Cost: Kling offers 2 free clips a day, with a premium subscription available for $92 per month."],
  ["Dream Machine", "New Features: Luma 1.6, released just last week, introduced a camera control feature with 12 different camera motions. Text to Video: Dream Machine often produces slow-motion-like movement. Cost: The free tier gives you 30 generations per month, with a $29/month plan for 150 generations."],
  ["Haiper", "Text to Video: The final clips from Haiper aren't particularly realistic. The resolution is soft, which isn't ideal for a polished, professional look. Cost: Haiper is priced at $30 per month for unlimited generations."],
  ["Pixverse", "Text to Video: We were impressed with Pixverse’s ability to generate readable text with minimal warping. Cost: Pixverse gives you 6 free generations, and their $30/month plan allows up to 333 videos."]
]

const slider = new rgbKineticSlider({
  slideImages: images, // array of images > must be 1920 x 1080
  itemsTitles: texts, // array of titles / subtitles

  backgroundDisplacementSprite: 'https://images.unsplash.com/photo-1558865869-c93f6f8482af?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=2081&q=80',
  cursorDisplacementSprite: 'https://images.unsplash.com/photo-1558865869-c93f6f8482af?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=2081&q=80',

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

  imagesRgbEffect: false,
  imagesRgbIntensity: 0.9,
  navImagesRgbIntensity: 80,

  textsDisplay: true,
  textsSubTitleDisplay: true,
  textsTiltEffect: true,
  googleFonts: ['Playfair Display:700', 'Roboto:400'],
  buttonMode: false,
  textsRgbEffect: true,
  textsRgbIntensity: 0.03,
  navTextsRgbIntensity: 15,

  textTitleColor: 'white',
  textTitleSize: 125,
  mobileTextTitleSize: 125,
  textTitleLetterspacing: 3,
  textTitleOffsetTop: 50, // Increased spacing to prevent overlap

  textSubTitleColor: 'white',
  textSubTitleSize: 21,
  mobileTextSubTitleSize: 21,
  textSubTitleLetterspacing: 2,
  textSubTitleOffsetTop: 150, // Adjusted to ensure space between title and subtitle
  mobileTextSubTitleOffsetTop: 150,
});

// Detect device type
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

if (isMobile && window.DeviceOrientationEvent) {
  // Add device motion support for mobile
  window.addEventListener('deviceorientation', (event) => {
    const { beta, gamma } = event; // beta (tilt front-back), gamma (tilt left-right)
    const normalizedGamma = (gamma + 90) / 180; // Normalize from [-90, 90] to [0, 1]
    const normalizedBeta = (beta + 180) / 360; // Normalize from [-180, 180] to [0, 1]

    // Use these values to control the distortion effect, similar to the mouse movement
    slider.setEffectValues(normalizedGamma, normalizedBeta);
  });
} else {
  // Existing mouse move handling (for desktop)
  document.addEventListener('mousemove', (event) => {
    const x = event.clientX / window.innerWidth;
    const y = event.clientY / window.innerHeight;

    // Use x and y to control the distortion effect
    slider.setEffectValues(x, y);
  });
}

// Ensure this function exists in your rgbKineticSlider class
rgbKineticSlider.prototype.setEffectValues = function (x, y) {
  // Update distortion effect intensity or other values based on x and y
  // For example, you might scale the displacement or intensity here
  this.cursorScaleIntensity = 0.65 * (1 - y);
  this.cursorMomentum = 0.14 * (1 - x);
};
