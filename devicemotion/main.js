// WebGL Shader Background
var container;
var camera, scene, renderer;
var uniforms;

var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

init();
animate();

// Function to request device orientation access on iOS
function requestDeviceOrientationPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientation);
                }
            })
            .catch(console.error);
    } else {
        // Handle non-iOS devices
        window.addEventListener('deviceorientation', handleOrientation);
    }
}

// Initialize WebGL and shaders
function init() {
    container = document.getElementById('container');

    camera = new THREE.Camera();
    camera.position.z = 1;

    scene = new THREE.Scene();

    var geometry = new THREE.PlaneBufferGeometry(2, 2);

    uniforms = {
        time: { value: 1.0 },
        resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        mouse: { value: new THREE.Vector2() }
    };

    var material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: document.getElementById('vertexShader').textContent,
        fragmentShader: document.getElementById('fragmentShader').textContent
    });

    var mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    renderer = new THREE.WebGLRenderer();
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    onWindowResize();
    window.addEventListener('resize', onWindowResize, false);

    if (isMobile) {
        document.body.addEventListener('click', requestDeviceOrientationPermission, { once: true });
    } else {
        window.addEventListener('mousemove', onMouseMove, false);
    }
}

// Handle device orientation event
function handleOrientation(event) {
    var x = event.gamma || 0;  // Left-right tilt
    var y = event.beta || 0;   // Front-back tilt

    uniforms.mouse.value.x = window.innerWidth / 2 + x * 20;  // Adjust sensitivity
    uniforms.mouse.value.y = window.innerHeight / 2 + y * 20;
}

// Handle window resize
function onWindowResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    uniforms.resolution.value.x = renderer.domElement.width;
    uniforms.resolution.value.y = renderer.domElement.height;
}

// Mouse move fallback for desktop
function onMouseMove(event) {
    uniforms.mouse.value.x = event.clientX;
    uniforms.mouse.value.y = renderer.domElement.height - event.clientY;
}

// Animate and render the scene
function animate() {
    requestAnimationFrame(animate);
    render();
}

// Render the WebGL scene
function render() {
    uniforms.time.value += 0.05;
    renderer.render(scene, camera);
}

// Star Field Overlay
(function($, window, document, undefined) {
    var Starfield = function(el, options) {
        this.el = el;
        this.$el = $(el);
        this.options = options;

        that = this;
    };

    Starfield.prototype = {
        defaults: {
            starColor: "rgba(255,255,255,1)", 
            bgColor: "rgba(0,0,0,0)",
            fps: 15,
            speed: 3,
            quantity: 512,
            ratio: 256,
            divclass: "starfield"
        },

        init: function() {
            this.settings = $.extend({}, this.defaults, this.options);

            var canvasInit = () => {
                that.w = that.$el.width();
                that.h = that.$el.height();

                that.wrapper = $('<canvas />').addClass(that.settings.divclass);
                that.wrapper.appendTo(that.el);

                that.starz = $('canvas', that.el);

                if (that.starz[0].getContext) {
                    that.context = that.starz[0].getContext('2d');
                    canCanvas = true;
                }

                that.context.canvas.width = that.w;
                that.context.canvas.height = that.h;
            };
            canvasInit();
        },

        anim: function() {
            this.context.clearRect(0, 0, this.w, this.h);  // Clear stars
            this.context.fillStyle = 'rgba(0, 0, 0, 0.2)';  // Slight fade effect
            this.context.fillRect(0, 0, this.w, this.h);

            for (var i = 0; i < this.n; i++) {
                this.context.beginPath();
                this.context.arc(Math.random() * this.w, Math.random() * this.h, 2, 0, Math.PI * 2);
                this.context.fill();
            }
        },

        loop: function() {
            this.anim();
            window.requestAnimationFrame(() => { that.loop(); });
        },

        start: function() {
            this.init();
            this.loop();
        }
    };

    $.fn.starfield = function(options) {
        return this.each(function() {
            new Starfield(this, options).start();
        });
    };
})(jQuery, window, document);

$('.starfield').starfield();
