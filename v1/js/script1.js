let useGyro = false;

window.addEventListener('deviceorientation', handleOrientation, true);

function handleOrientation(event) {
    const { alpha, beta, gamma } = event;

    if (useGyro) {
        // Map gamma (left-right tilt) and beta (forward-back tilt) to starfield movement
        movePointer(gamma * 5 + (window.innerWidth / 2), beta * 5 + (window.innerHeight / 2));
    }
}

window.onload = function() {
    // Detect if the device has a gyroscope (common on mobile devices)
    if ('DeviceOrientationEvent' in window) {
        // Enable gyroscope input
        useGyro = true;

        // Optional: Use a fallback for older browsers that may need permission for the gyro (for iOS >= 13)
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission().then(response => {
                if (response === 'granted') {
                    useGyro = true;
                } else {
                    useGyro = false; // If permission denied, revert to touch input
                }
            }).catch(console.error);
        }
    }
};

function movePointer(x, y) {
    if (typeof pointerX === 'number' && typeof pointerY === 'number') {
        let ox = x - pointerX,
            oy = y - pointerY;

        velocity.tx = velocity.tx + (ox / 8) * scale * (touchInput ? 1 : -1);
        velocity.ty = velocity.ty + (oy / 8) * scale * (touchInput ? 1 : -1);
    }

    pointerX = x;
    pointerY = y;
}
