(function () {
  'use strict';

  // ---- scene "beats": each is a stop along the flythrough with its own
  // depth, palette (the "time of day"), and objects (the "space"). ----
  var DEPTH_STEP = 420; // world units of camera travel per beat
  var BEATS = [
    { name: 'dawn', z: 0, sky: 0xffb37a, fog: 0xffb37a, light: 0xffdca8, ambient: 0x33241a },
    { name: 'day', z: -DEPTH_STEP, sky: 0x8fd0ff, fog: 0x8fd0ff, light: 0xffffff, ambient: 0x334455 },
    { name: 'dusk', z: -DEPTH_STEP * 2, sky: 0xff7a5c, fog: 0x4a2a4a, light: 0xff9a7a, ambient: 0x2a1830 },
    { name: 'night', z: -DEPTH_STEP * 3, sky: 0x05060a, fog: 0x05060a, light: 0x6f8fff, ambient: 0x0a0a18 }
  ];
  var TOTAL_DEPTH = DEPTH_STEP * (BEATS.length - 1);

  var canvas = document.getElementById('scene-canvas');
  var progressFill = document.getElementById('progress-fill');
  var scrollHint = document.getElementById('scroll-hint');
  var beatEls = Array.prototype.slice.call(document.querySelectorAll('.beat'));

  // the DOM has one extra "outro" section after the beats, which stretches
  // the page beyond the beats themselves — scale scroll progress so the
  // camera/lighting finish their journey exactly as the last beat text
  // arrives, then hold "night" through the outro instead of undershooting it.
  var TOTAL_SECTIONS = beatEls.length + 1;
  var BEAT_FRACTION = beatEls.length / TOTAL_SECTIONS;

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  var scene = new THREE.Scene();
  var currentColor = new THREE.Color(BEATS[0].sky);
  scene.background = currentColor;
  scene.fog = new THREE.Fog(BEATS[0].fog, 60, 520);

  var camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 8, 40);

  var ambientLight = new THREE.AmbientLight(BEATS[0].ambient, 1);
  scene.add(ambientLight);

  var keyLight = new THREE.DirectionalLight(BEATS[0].light, 1.1);
  keyLight.position.set(30, 60, 20);
  scene.add(keyLight);

  // ---- I. dawn: skyline ----
  var skylineGroup = new THREE.Group();
  skylineGroup.position.set(0, -18, BEATS[0].z - 20);
  scene.add(skylineGroup);

  new THREE.OBJLoader().load('../Helsingborg_SF_Skyline.obj', function (obj) {
    obj.traverse(function (child) {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({ color: 0x1c1420, roughness: 0.8, metalness: 0.1 });
      }
    });
    skylineGroup.add(obj);
  });

  // ---- II. day: the sphere ----
  var sphereGroup = new THREE.Group();
  sphereGroup.position.set(6, 6, BEATS[1].z - 10);
  scene.add(sphereGroup);

  var sphereMesh = new THREE.Mesh(
    new THREE.SphereGeometry(16, 48, 48),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })
  );
  sphereGroup.add(sphereMesh);

  new THREE.TextureLoader().load('../sphere.jpg', function (tex) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    sphereMesh.material.map = tex;
    sphereMesh.material.needsUpdate = true;
  });

  // ---- III. dusk: crystalline drift ----
  var crystalGroup = new THREE.Group();
  crystalGroup.position.set(-4, 4, BEATS[2].z - 6);
  scene.add(crystalGroup);

  var crystalGeoms = [
    new THREE.IcosahedronGeometry(6, 0),
    new THREE.OctahedronGeometry(5, 0),
    new THREE.TetrahedronGeometry(5, 0)
  ];
  var crystalMeshes = [];
  for (var i = 0; i < 7; i++) {
    var geom = crystalGeoms[i % crystalGeoms.length];
    var mat = new THREE.MeshStandardMaterial({ color: 0xd9c7ff, roughness: 0.25, metalness: 0.4, flatShading: true });
    var mesh = new THREE.Mesh(geom, mat);
    var angle = (i / 7) * Math.PI * 2;
    var radius = 14 + (i % 3) * 6;
    mesh.position.set(Math.cos(angle) * radius, Math.sin(angle * 1.7) * 8, Math.sin(angle) * radius);
    mesh.userData.spin = 0.1 + Math.random() * 0.3;
    crystalGroup.add(mesh);
    crystalMeshes.push(mesh);
  }

  new THREE.TextureLoader().load('../labradorite-texture.png', function (tex) {
    crystalMeshes.forEach(function (mesh) {
      mesh.material.map = tex;
      mesh.material.needsUpdate = true;
    });
  });

  // ---- IV. night: deep field starfield ----
  var starGeometry = new THREE.BufferGeometry();
  var STAR_COUNT = 2200;
  var starPositions = new Float32Array(STAR_COUNT * 3);
  for (var s = 0; s < STAR_COUNT; s++) {
    starPositions[s * 3] = (Math.random() - 0.5) * 500;
    starPositions[s * 3 + 1] = (Math.random() - 0.5) * 300;
    starPositions[s * 3 + 2] = BEATS[3].z - Math.random() * 400;
  }
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  var starField = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: true })
  );
  scene.add(starField);

  // faint stars visible from the very start, for depth
  var farStarGeometry = new THREE.BufferGeometry();
  var farPositions = new Float32Array(900 * 3);
  for (var f = 0; f < 900; f++) {
    farPositions[f * 3] = (Math.random() - 0.5) * 800;
    farPositions[f * 3 + 1] = (Math.random() - 0.5) * 400;
    farPositions[f * 3 + 2] = -Math.random() * TOTAL_DEPTH - 200;
  }
  farStarGeometry.setAttribute('position', new THREE.BufferAttribute(farPositions, 3));
  scene.add(new THREE.Points(farStarGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, opacity: 0.5, transparent: true })));

  // ---- scroll -> progress ----
  var scrollProgress = 0; // 0..1, raw
  var smoothProgress = 0; // eased

  function getScrollProgress() {
    var max = document.body.scrollHeight - window.innerHeight;
    if (max <= 0) return 0;
    return Math.min(1, Math.max(0, window.scrollY / max));
  }

  function updateHUD(p) {
    progressFill.style.width = (p * 100).toFixed(2) + '%';
  }

  function lerpColor(a, b, t) {
    return a.clone().lerp(b, t);
  }

  var colorA = new THREE.Color();
  var colorB = new THREE.Color();
  var fogColor = new THREE.Color();
  var ambientColor = new THREE.Color();
  var lightColor = new THREE.Color();

  function applyBeatBlend(p) {
    var scaled = p * (BEATS.length - 1);
    var idx = Math.min(BEATS.length - 2, Math.floor(scaled));
    var t = scaled - idx;
    var a = BEATS[idx];
    var b = BEATS[idx + 1];

    colorA.set(a.sky); colorB.set(b.sky);
    currentColor.copy(lerpColor(colorA, colorB, t));
    scene.background = currentColor;

    colorA.set(a.fog); colorB.set(b.fog);
    fogColor.copy(lerpColor(colorA, colorB, t));
    scene.fog.color.copy(fogColor);

    colorA.set(a.ambient); colorB.set(b.ambient);
    ambientColor.copy(lerpColor(colorA, colorB, t));
    ambientLight.color.copy(ambientColor);

    colorA.set(a.light); colorB.set(b.light);
    lightColor.copy(lerpColor(colorA, colorB, t));
    keyLight.color.copy(lightColor);
  }

  window.addEventListener('scroll', function () {
    scrollProgress = getScrollProgress();
    if (scrollProgress > 0.01 && scrollHint) scrollHint.classList.add('hidden');
  }, { passive: true });

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  // reveal beat text as it nears the viewport center
  var beatObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var inner = entry.target.querySelector('.beat-inner');
      if (!inner) return;
      if (entry.isIntersecting) inner.classList.add('visible');
      else inner.classList.remove('visible');
    });
  }, { threshold: 0.45 });
  beatEls.forEach(function (el) { beatObserver.observe(el); });
  var outroInner = document.querySelector('.outro .beat-inner');
  if (outroInner) {
    var outroObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) outroInner.classList.add('visible');
      });
    }, { threshold: 0.4 });
    outroObserver.observe(document.querySelector('.outro'));
  }

  // gentle mouse parallax
  var mouseX = 0, mouseY = 0;
  window.addEventListener('mousemove', function (e) {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  var clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    var dt = clock.getDelta();
    var elapsed = clock.elapsedTime;

    smoothProgress += (scrollProgress - smoothProgress) * 0.08;
    updateHUD(smoothProgress);
    var beatProgress = Math.min(1, smoothProgress / BEAT_FRACTION);
    applyBeatBlend(beatProgress);

    var targetZ = 40 - beatProgress * (TOTAL_DEPTH + 60);
    camera.position.z = targetZ;
    camera.position.x = Math.sin(elapsed * 0.15) * 2 + mouseX * 3;
    camera.position.y = 8 + Math.cos(elapsed * 0.12) * 1.5 + mouseY * 2;
    camera.lookAt(camera.position.x * 0.5, 6, camera.position.z - 40);

    sphereMesh.rotation.y += dt * 0.15;
    crystalMeshes.forEach(function (mesh) {
      mesh.rotation.x += dt * mesh.userData.spin * 0.4;
      mesh.rotation.y += dt * mesh.userData.spin;
    });
    starField.rotation.y += dt * 0.01;

    renderer.render(scene, camera);
  }

  animate();
})();
