document.addEventListener("DOMContentLoaded", () => {
    const images = document.querySelectorAll(".zoom-image");
    let currentImageIndex = 0;

    function showNextImage() {
        images[currentImageIndex].classList.remove("visible");
        currentImageIndex = (currentImageIndex + 1) % images.length;
        images[currentImageIndex].classList.add("visible");
    }

    images[currentImageIndex].classList.add("visible");
    setInterval(showNextImage, 3000); // Change image every 3 seconds
});
