/*          *     .        *  .    *    *   . 
 .  *  move your device to navigate the stars   .
 *  .  .   change these values:   .  *
   .      * .        .          * .       */
const STAR_COLOR = '#fff';
const STAR_SIZE = 3;
const STAR_MIN_SCALE = 0.2;
const OVERFLOW_THRESHOLD = 50;
const STAR_COUNT = (window.innerWidth + window.innerHeight) / 8;

const canvas = document.querySelector('canvas'),
    context = canvas.getContext('2d');

let scale = 1, // device pixel ratio
    width,
    height;

let stars = [];

let pointerX,
    pointerY;

let velocity = { x: 0, y: 0, tx: 0, ty: 0, z: 0.0005 };

// Removed touchInput as we are now using device motion
// let touchInput = false;

generate();
resize();
step();

window.onresize = resize;
// Removed touch event listeners
// canvas.onmousemove = onMouseMove;
// canvas.ontouchmove = onTouchMove;
// canvas.ontouchend = onMouseLeave;
// document.onmouseleave = onMouseLeave;

// Add a new event listener for device motion
window.addEventListener('devicemotion', onDeviceMotion, true);

function onDeviceMotion(event) {
    // Get the acceleration including gravity from the event
    const { x, y } = event.accelerationIncludingGravity;

    // You might need to adjust the multiplier to control the sensitivity
    velocity.tx = x * 0.5; // Adjusted for more sensitivity
    velocity.ty = y * 0.5; // Adjusted for more sensitivity
}

function generate() {
    // ... [existing generate function code] ...
}

function placeStar(star) {
    // ... [existing placeStar function code] ...
}

function recycleStar(star) {
    // ... [existing recycleStar function code] ...
}

function resize() {
    // ... [existing resize function code] ...
}

function step() {
    // ... [existing step function code] ...
}

function update() {
    // ... [existing update function code] ...
}

function render() {
    // ... [existing render function code] ...
}

// Removed touch event handlers
// function onMouseMove(event) { ... }
// function onTouchMove(event) { ... }
// function onMouseLeave() { ... }

// You can also remove the movePointer function as it's no longer needed
// function movePointer(x, y) { ... }
