const canvas = document.querySelector('canvas');
if (!canvas) {
    console.error('Canvas not found');
} else {
    console.log('Canvas found');
    const context = canvas.getContext('2d');

    const STAR_COLOR = '#fff';
    const STAR_SIZE = 3;
    const STAR_MIN_SCALE = 0.2;
    const OVERFLOW_THRESHOLD = 50;
    const STAR_COUNT = (window.innerWidth + window.innerHeight) / 8;

    let scale = 1, // device pixel ratio
        width,
        height;

    let stars = [];

    let pointerX,
        pointerY;

    let velocity = { x: 0, y: 0, tx: 0, ty: 0, z: 0.0005 };

    let touchInput = false;

    generate();
    resize();
    step();

    window.onresize = resize;
    canvas.onmousemove = onMouseMove;
    canvas.ontouchmove = onTouchMove;
    canvas.ontouchend = onMouseLeave;
    document.onmouseleave = onMouseLeave;

    function generate() {
        for (let i = 0; i < STAR_COUNT; i++) {
            stars.push({
                x: 0,
                y: 0,
                z: STAR_MIN_SCALE + Math.random() * (1 - STAR_MIN_SCALE)
            });
        }
    }

    function placeStar(star) {
        star.x = Math.random() * width;
        star.y = Math.random() * height;
    }

    function recycleStar(star) {
        // Recycle logic for stars
    }

    function resize() {
        scale = window.devicePixelRatio || 1;
        width = window.innerWidth * scale;
        height = window.innerHeight * scale;

        canvas.width = width;
        canvas.height = height;

        stars.forEach(placeStar);
    }

    function step() {
        context.clearRect(0, 0, width, height);
        update();
        render();
        requestAnimationFrame(step);
    }

    function update() {
        // Update star positions
    }

    function render() {
        stars.forEach(star => {
            context.beginPath();
            context.lineCap = 'round';
            context.lineWidth = STAR_SIZE * star.z * scale;
            context.globalAlpha = 0.5 + 0.5 * Math.random();
            context.strokeStyle = STAR_COLOR;

            context.moveTo(star.x, star.y);
            context.lineTo(star.x + velocity.x * 2, star.y + velocity.y * 2);
            context.stroke();
        });
    }

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

    function onMouseMove(event) {
        movePointer(event.clientX, event.clientY);
    }

    function onTouchMove(event) {
        movePointer(event.touches[0].clientX, event.touches[0].clientY);
        event.preventDefault();
    }

    function onMouseLeave() {
        pointerX = null;
        pointerY = null;
    }
} // This closes the 'else' block that checks for the canvas
