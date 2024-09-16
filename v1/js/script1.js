if (!canvas) {
    console.error('Canvas not found');
} else {
    console.log('Canvas found');
    const context = canvas.getContext('2d');

    // The rest of the code defining the starfield logic (functions, events, etc.)

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
}
// Closing the outer function (if applicable)
