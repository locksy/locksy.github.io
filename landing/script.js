// WebGL Shader Background
var container;
var camera, scene, renderer;
var uniforms;
var mouseX, mouseY;
var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

function init() {
    container = document.getElementById('container');

    camera = new THREE.Camera();
    camera.position.z = 1;

    scene = new THREE.Scene();

    var geometry = new THREE.PlaneBufferGeometry(2, 2);

    uniforms = {
        time: { value: 1.0 },
        resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        mouse: { value: new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2) } // Start at center
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

    // Handle device orientation on mobile
    if (isMobile) {
        requestDeviceOrientationPermission();
    } else {
        window.addEventListener('mousemove', onMouseMove, false);
    }

    onWindowResize(); // Ensure it is called after the renderer is ready
    window.addEventListener('resize', onWindowResize, false);
}

function requestDeviceOrientationPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(permissionState => {
            if (permissionState === 'granted') {
                window.addEventListener('deviceorientation', handleOrientation, false);
            }
        }).catch(console.error);
    } else {
        window.addEventListener('deviceorientation', handleOrientation, false);
    }
}

function handleOrientation(event) {
    var gamma = event.gamma;  // Rotation around y-axis (left to right)
    var beta = event.beta;    // Rotation around x-axis (front to back)

    // Adjust the values to work well with WebGL coordinates
    mouseX = window.innerWidth / 2 + gamma * 5; 
    mouseY = window.innerHeight / 2 + beta * 5;

    // Update the mouse uniform
    uniforms.mouse.value.x = mouseX;
    uniforms.mouse.value.y = mouseY;
}

function onMouseMove(event) {
    mouseX = event.clientX;
    mouseY = event.clientY;

    // Update the mouse uniform
    uniforms.mouse.value.x = mouseX;
    uniforms.mouse.value.y = renderer.domElement.height - mouseY;
}

function onWindowResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    uniforms.resolution.value.x = renderer.domElement.width;
    uniforms.resolution.value.y = renderer.domElement.height;
}

function animate() {
    requestAnimationFrame(animate);
    render();
}

function render() {
    uniforms.time.value += 0.05;
    renderer.render(scene, camera);
}

// Initialize after the DOM has fully loaded
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
        init(); // Initialize WebGL after a short delay
        animate(); // Start the animation
    }, 100); // Small delay to help with loading times
});

// Star Field Overlay
(function($, window, document) {
    var Starfield = function(el, options) {
        this.el = el;
        this.$el = $(el);
        this.options = options;

        that = this;
    };

    var isPlaying;
    var isInited = false;
    var canCanvas = false;
    var animId;

    Starfield.prototype = {
        defaults: {
            starColor: "rgba(255,255,255,1)", 
            bgColor: "rgba(0,0,0,0)", /* Transparent background */
            mouseMove: true,
            mouseColor: "rgba(0,0,0,0.2)",
            mouseSpeed: 20,
            fps: 15,
            speed: 3,
            quantity: 512,
            ratio: 256,
            divclass: "starfield"
        },

        resizer: function() {
            var oldStar = this.star;
            var initW = this.context.canvas.width;
            var initH = this.context.canvas.height;

            this.w = this.$el.width();
            this.h = this.$el.height();
            this.x = Math.round(this.w / 2);
            this.y = Math.round(this.h / 2);

            this.portrait = this.w < this.h;

            var ratX = this.w / initW;
            var ratY = this.h / initH;

            this.context.canvas.width = this.w;
            this.context.canvas.height = this.h;

            for (var i = 0; i < this.n; i++) {
                this.star[i][0] = oldStar[i][0] * ratX;
                this.star[i][1] = oldStar[i][1] * ratY;

                this.star[i][3] = this.x + (this.star[i][0] / this.star[i][2]) * this.star_ratio;
                this.star[i][4] = this.y + (this.star[i][1] / this.star[i][2]) * this.star_ratio;
            }

            that.context.fillStyle = that.settings.bgColor;
            this.context.strokeStyle = this.settings.starColor;
        },

        init: function() {
            this.settings = $.extend({}, this.defaults, this.options);

            this.n = this.settings.quantity;
            this.w = this.$el.width();
            this.h = this.$el.height();
            this.x = Math.round(this.w / 2);
            this.y = Math.round(this.h / 2);

            var canvasInit = function() {
                that.context = $('<canvas />').addClass(that.settings.divclass)[0].getContext('2d');
                that.context.canvas.width = that.w;
                that.context.canvas.height = that.h;

                that.$el.append(that.context.canvas);
            };

            canvasInit();

            var starInit = function() {
                that.z = (that.w + that.h) / 2;
                that.star = new Array(that.n);
                that.cursor_x = that.x;
                that.cursor_y = that.y;

                for (var i = 0; i < that.n; i++) {
                    that.star[i] = [Math.random() * that.w * 2 - that.x * 2, Math.random() * that.h * 2 - that.y * 2, Math.round(Math.random() * that.z), 0, 0];
                }

                that.context.fillStyle = that.settings.bgColor;
                that.context.strokeStyle = that.settings.starColor;
            };

            starInit();
            isInited = true;
        },

        anim: function() {
            this.context.clearRect(0, 0, this.w, this.h);
            this.context.fillStyle = 'rgba(0, 0, 0, 0.2)';
            this.context.fillRect(0, 0, this.w, this.h);

            for (var i = 0; i < this.n; i++) {
                this.star[i][0] += this.cursor_x >> 4;
                this.star[i][1] += this.cursor_y >> 4;
                this.star[i][2] -= this.settings.speed;

                if (this.star[i][2] < 0) this.star[i][2] += this.z;

                this.context.lineWidth = (1 - (this.star[i][2] / this.z)) * 2;
                this.context.beginPath();
                this.context.moveTo(this.star[i][3], this.star[i][4]);
                this.context.lineTo(this.star[i][0], this.star[i][1]);
                this.context.stroke();
            }
        },

        loop: function() {
            this.anim();
            animId = window.requestAnimationFrame(function() { that.loop(); });
        },

        start: function() {
            if (!isInited) {
                isInited = true;
                this.init();
            }

            if (!isPlaying) {
                isPlaying = true;
                this.loop();
            }
        }
    };

    $.fn.starfield = function(options) {
        return this.each(function() {
            new Starfield(this, options).start();
        });
    };

    $('.starfield').starfield();

})(jQuery, window, document);
