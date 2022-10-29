let images = [...document.querySelectorAll('.image')];
let slider = document.querySelector('.slider');
let sliderWidth;
let imageWidth;
let current = 0;
let target = 0;
let ease = 0.05;

window.addEventListener('resize', init)

// Adding background images to the divs
images.forEach((image, index) => {
  image.style.backgroundImage = `url(./images/${index+1}.jpg)`
})

// Linear interpolation function
function lerp(start, end, t) {
  return start * (1-t) + end * t;
}

// Transform function
function setTransform(el, transform) {
  el.style.transform = transform;
}

// Init function
function init() {
  sliderWidth = slider.getBoundingClientRect().width;
  imageWidth = sliderWidth/images.length;
  document.body.style.height = `${sliderWidth - (window.innerWidth - window.innerHeight)}px`
}

// Animating slider
function animate() {
  current = parseFloat(lerp(current, target, ease)).toFixed(2);
  target = window.scrollY;
  setTransform(slider, `translateX(${-current}px)`)
  animateImages()
  requestAnimationFrame(animate)
}

// Animating images for parallax effect
function animateImages() {
 let ratio = current / imageWidth;
 let intersectionRatioValue;
 
 images.forEach((image, index) => {
   intersectionRatioValue = ratio - (index * 0.7)
   setTransform(image, `translateX(${intersectionRatioValue * 70}px)`)
 })
}

init()
animate()
