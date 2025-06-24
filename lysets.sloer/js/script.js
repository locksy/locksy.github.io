// lysets.slør — last working desktop-only version
const container = document.getElementById('container');
const imageCount = 7;           // images 1.JPG through 7.JPG in /img
const images = [];
let currentIndex = 0;

// preload all images
for (let i = 1; i <= imageCount; i++) {
  const img = document.createElement('img');
  img.src = `img/${i}.JPG`;
  images.push(img);
}

// show the first image
container.appendChild(images[0]);

// swap images on horizontal mouse move
container.addEventListener('mousemove', e => {
  const rect = container.getBoundingClientRect();
  const xNorm = (e.clientX - rect.left) / rect.width;
  const newIndex = Math.min(
    imageCount - 1,
    Math.floor(xNorm * imageCount)
  );
  if (newIndex !== currentIndex) {
    container.replaceChild(images[newIndex], images[currentIndex]);
    currentIndex = newIndex;
  }
});
