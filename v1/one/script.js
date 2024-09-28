console.log('script.js is loaded and running');

// Ensure the code runs after the DOM is ready
$(document).ready(function() {
    // WebGL Shader Background
    var container;
    var camera, scene, renderer;
    var uniforms;

    init();
    animate();

    function init() {
        container = document.getElementById('container');

        camera = new THREE.Camera();
        camera.position.z = 1;

        scene = new THREE.Scene();

        var geometry = new THREE.PlaneBufferGeometry(2, 2);

        uniforms = {
            time: { value: 1.0 },
            resolution: { value: new THREE.Vector2() },
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
        container.appendChild(renderer.domElement);

        onWindowResize();
        window.addEventListener('resize', onWindowResize, false);

        // Mouse move event for desktop interaction
        window.addEventListener('mousemove', onMouseMove, false);

        // Initialize device orientation
        initializeDeviceOrientation();
    }

    function onWindowResize() {
        renderer.setSize(window.innerWidth, window.innerHeight);
        uniforms.resolution.value.x = renderer.domElement.width;
        uniforms.resolution.value.y = renderer.domElement.height;
    }

    function onMouseMove(event) {
        uniforms.mouse.value.x = event.clientX / window.innerWidth;
        uniforms.mouse.value.y = 1 - (event.clientY / window.innerHeight);
    }

    function animate() {
        requestAnimationFrame(animate);
        render();
    }

    function render() {
        uniforms.time.value += 0.05;
        renderer.render(scene, camera);
    }

    /* Device Orientation Integration */

    function initializeDeviceOrientation() {
        if (window.DeviceOrientationEvent) {
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
                $('#requestPermissionButton').show().on('click', function() {
                    DeviceOrientationEvent.requestPermission()
                        .then(permissionState => {
                            if (permissionState === 'granted') {
                                $('#requestPermissionButton').hide();
                                window.addEventListener('deviceorientation', handleDeviceOrientation);
                            } else {
                                alert('Permission to access device orientation was denied');
                            }
                        })
                        .catch(console.error);
                });
            } else {
                window.addEventListener('deviceorientation', handleDeviceOrientation);
            }
        } else {
            console.log('Device orientation is not supported');
        }
    }

    function handleDeviceOrientation(event) {
        var gamma = event.gamma; // Left to right tilt in degrees, range: -90 to 90
        var beta = event.beta;   // Front to back tilt in degrees, range: -180 to 180

        // Normalize gamma and beta to values between 0 and 1
        var x = (gamma + 90) / 180;
        var y = (beta + 180) / 360;

        // Update WebGL shader uniforms
        uniforms.mouse.value.x = x;
        uniforms.mouse.value.y = y;

        // Update starfield
        if (starfield && typeof starfield.updateStarOrientation === 'function') {
            starfield.updateStarOrientation(x, y);
        }
    }

    // Starfield
    var starfield;

    (function($, window, document) {
        var Starfield = function(el, options) {
            this.el = el;
            this.$el = $(el);
            this.options = options;

            this.defaults = {
                starColor: "rgba(255,255,255,1)",
                bgColor: "rgba(0,0,0,0)",
                mouseMove: true,
                mouseColor: "rgba(0,0,0,0.2)",
                mouseSpeed: 20,
                fps: 60,
                speed: 3,
                quantity: 512,
                ratio: 256,
                divclass: "starfield"
            };

            this.settings = $.extend({}, this.defaults, this.options);

            this.init();
        };

        Starfield.prototype.init = function() {
            this.stars = [];
            this.canvas = null;
            this.context = null;
            this.reqAnimationFrame = window.requestAnimationFrame || 
                                     window.mozRequestAnimationFrame ||
                                     window.webkitRequestAnimationFrame || 
                                     window.msRequestAnimationFrame;
            this.canvasWidth = 0;
            this.canvasHeight = 0;

            this.createCanvas();
            this.createStars();
            this.start();
        };

        Starfield.prototype.createCanvas = function() {
            var canvas = document.createElement('canvas');
            this.canvas = canvas;
            this.context = canvas.getContext('2d');
            this.$el.append(canvas);

            this.updateCanvasSize();
            
            window.addEventListener('resize', this.updateCanvasSize.bind(this), false);
        };

        Starfield.prototype.updateCanvasSize = function() {
            this.canvasWidth = window.innerWidth;
            this.canvasHeight = window.innerHeight;
            this.canvas.width = this.canvasWidth;
            this.canvas.height = this.canvasHeight;
        };

        Starfield.prototype.createStars = function() {
            var quantity = this.settings.quantity;
            for (var i = 0; i < quantity; i++) {
                this.stars.push(new Star(this));
            }
        };

        Starfield.prototype.start = function() {
            this.reqAnimationFrame.call(window, this.render.bind(this));
        };

        Starfield.prototype.render = function() {
            this.context.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
            for (var i = 0, len = this.stars.length; i < len; i++) {
                this.stars[i].render(this.context);
            }
            this.reqAnimationFrame.call(window, this.render.bind(this));
        };

        Starfield.prototype.updateStarOrientation = function(x, y) {
            var centerX = this.canvasWidth / 2;
            var centerY = this.canvasHeight / 2;
            var maxDistance = Math.max(centerX, centerY);
            
            for (var i = 0, len = this.stars.length; i < len; i++) {
                var star = this.stars[i];
                var distanceX = star.x - centerX;
                var distanceY = star.y - centerY;
                
                star.x += (x - 0.5) * (distanceX / maxDistance) * 10;
                star.y += (y - 0.5) * (distanceY / maxDistance) * 10;
                
                if (star.x < 0) star.x = this.canvasWidth;
                if (star.x > this.canvasWidth) star.x = 0;
                if (star.y < 0) star.y = this.canvasHeight;
                if (star.y > this.canvasHeight) star.y = 0;
            }
        };

        function Star(starfield) {
            this.starfield = starfield;
            this.reset();
        }

        Star.prototype.reset = function() {
            this.x = Math.random() * this.starfield.canvasWidth;
            this.y = Math.random() * this.starfield.canvasHeight;
            this.size = Math.random() * 2;
            this.speed = Math.random() * 0.5 + 0.1;
        };

        Star.prototype.render = function(context) {
            context.beginPath();
            context.arc(this.x, this.y, this.size, 0, 2 * Math.PI);
            context.fillStyle = this.starfield.settings.starColor;
            context.fill();

            this.update();
        };

        Star.prototype.update = function() {
            this.y += this.speed;
            if (this.y > this.starfield.canvasHeight) {
                this.reset();
                this.y = 0;
            }
        };

        // Initialize the starfield
        starfield = new Starfield($('.starfield')[0], {});

    })(jQuery, window, document);

    // Initialize device orientation at the end
    initializeDeviceOrientation();
});