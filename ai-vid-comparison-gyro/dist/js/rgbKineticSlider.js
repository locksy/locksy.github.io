(function() {
    window.rgbKineticSlider = function(options) {
        // ... (keep existing options)

        // Add new option for gyroscope control
        options.useGyroscope = options.hasOwnProperty('useGyroscope') ? options.useGyroscope : false;

        // ... (keep existing variable declarations)

        let gyroX = 0, gyroY = 0;
        let isGyroActive = false;

        // ... (keep existing functions until cursorInteractive)

        function cursorInteractive() {
            if (options.useGyroscope && window.DeviceOrientationEvent) {
                window.addEventListener("deviceorientation", handleOrientation);
            } else {
                window.addEventListener("mousemove", onPointerMove);
                window.addEventListener("touchmove", onTouchMove);
            }

            // ... (keep existing onPointerMove and onTouchMove functions)

            function handleOrientation(event) {
                isGyroActive = true;
                gyroX = event.gamma;  // Range: -90 to 90
                gyroY = event.beta;   // Range: -180 to 180
            }

            // enable raf loop
            mainLoop();
        }

        function mainLoop() {
            // ... (keep existing code until vx and vy calculations)

            if (isGyroActive) {
                // Map gyroscope data to screen coordinates
                vx = (gyroX + 90) * (window.innerWidth / 180);
                vy = (gyroY + 180) * (window.innerHeight / 360);
            } else {
                vx += ((posx - vx) * options.cursorMomentum);
                vy += ((posy - vy) * options.cursorMomentum);
            }

            // ... (keep the rest of the mainLoop function)
        }

        // ... (keep the rest of the library code)

    };
})();
