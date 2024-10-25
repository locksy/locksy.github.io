// Error logging function
function logError(message) {
    console.error(message);
    var errorDiv = document.getElementById('error-log');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.id = 'error-log';
        document.body.appendChild(errorDiv);
    }
    errorDiv.style.display = 'block';
    errorDiv.innerHTML += message + '<br>';
}

// WebGL Shader Background
var container;
var camera, scene, renderer;
var uniforms;

try {
    init();
    animate();
} catch (error) {
    logError('Initialization error: ' + error.message);
}

function init() {
    try {
        container = document.getElementById('container');
        if (!container) throw new Error('Container element not found');

        camera = new THREE.Camera();
        camera.position.z = 1;

        scene = new THREE.Scene();

        var geometry = new THREE.PlaneBufferGeometry(2, 2);

        uniforms = {
            time: { value: 1.0 },
            resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
            mouse: { value: new THREE.Vector2() }
        };

        var vertexShader = document.getElementById('vertexShader');
        var fragmentShader = document.getElementById('fragmentShader');
        if (!vertexShader || !fragmentShader) throw new Error('Shader elements not found');

        var material = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: vertexShader.textContent,
            fragmentShader: fragmentShader.textContent
        });

        var mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        renderer = new THREE.WebGLRenderer();
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        container.appendChild(renderer.domElement);

        onWindowResize();
        window.addEventListener('resize', onWindowResize, false);
        window.addEventListener('mousemove', onMouseMove, false);
    } catch (error) {
        logError('Error in init(): ' + error.message);
    }
}

function onWindowResize(event) {
    renderer.setSize(window.innerWidth, window.innerHeight);
    uniforms.resolution.value.x = renderer.domElement.width;
    uniforms.resolution.value.y = renderer.domElement.height;
}

function updateMouseUniform(x, y) {
    uniforms.mouse.value.x = x;
    uniforms.mouse.value.y = renderer.domElement.height - y;
}

function onMouseMove(event) {
    updateMouseUniform(event.clientX, event.clientY);
}

function animate() {
    requestAnimationFrame(animate);
    render();
}

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

    var isPlaying;
    var isInited = false;
    var canCanvas = false;
    var animId;

    Starfield.prototype = {
        defaults: {
            starColor: "rgba(255,255,255,1)",
            bgColor: "rgba(0,0,0,0)",
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

            var url = document.location.href;
            this.n = parseInt(
                (url.indexOf('n=') != -1) ? url.substring(url.indexOf('n=') + 2, (
                    (url.substring(
                        url.indexOf('n=') + 2,
                        url.length)
                    ).indexOf('&') != -1) ? url.indexOf('n=') + 2 + (url.substring(
                        url.indexOf('n=') + 2,
                        url.length)
                    ).indexOf('&') :
                    url.length) :
                this.settings.quantity
            );

            this.flag = true;
            this.test = true;
            this.w = 0;
            this.h = 0;
            this.x = 0;
            this.y = 0;
            this.z = 0;
            this.star_color_ratio = 0;
            this.star_x_save = 0;
            this.star_y_save = 0;
            this.star_ratio = this.settings.ratio;
            this.star_speed = this.settings.speed;
            this.star_speed_save = 0;
            this.star = new Array(this.n);
            this.color = this.settings.starColor;
            this.opacity = 0.1;

            this.cursor_x = 0;
            this.cursor_y = 0;
            this.mouse_x = 0;
            this.mouse_y = 0;

            this.canvas_x = 0;
            this.canvas_y = 0;
            this.canvas_w = 0;
            this.canvas_h = 0;
            
            this.fps = this.settings.fps;

            this.desktop = !navigator.userAgent.match(/(iPhone|iPod|iPad|Android|BlackBerry|BB10|IEMobile)/);
            this.orientationSupport = window.DeviceOrientationEvent !== undefined;
            this.portrait = null;

            var canvasInit = function() {
                that.w = that.$el.width();
                that.h = that.$el.height();

                that.initW = that.w;
                that.initH = that.h;

                that.portrait = that.w < that.h;

                that.wrapper = $('<canvas />')
                    .addClass(that.settings.divclass);

                that.wrapper.appendTo(that.el);

                that.starz = $('canvas', that.el);

                if (that.starz[0].getContext) {
                    that.context = that.starz[0].getContext('2d');
                    canCanvas = true;
                }

                that.context.canvas.width = that.w;
                that.context.canvas.height = that.h;
            }
            canvasInit();

            var starInit = function() {
                if (canCanvas) {
                    that.x = Math.round(that.w / 2);
                    that.y = Math.round(that.h / 2);
                    that.z = (that.w + that.h) / 2;
                    that.star_color_ratio = 1 / that.z;
                    that.cursor_x = that.x;
                    that.cursor_y = that.y;

                    for (var i = 0; i < that.n; i++) {
                        that.star[i] = new Array(5);

                        that.star[i][0] = Math.random() * that.w * 2 - that.x * 2;
                        that.star[i][1] = Math.random() * that.h * 2 - that.y * 2;
                        that.star[i][2] = Math.round(Math.random() * that.z);
                        that.star[i][3] = 0;
                        that.star[i][4] = 0;
                    }

                    that.context.fillStyle = that.settings.bgColor;
                    that.context.strokeStyle = that.settings.starColor;
                } else {
                    return;
                }
            }
            starInit();

            isInited = true;
        },

        anim: function() {
            this.mouse_x = this.cursor_x - this.x;
            this.mouse_y = this.cursor_y - this.y;
            this.context.fillRect(0, 0, this.w, this.h);

            for (var i = 0; i < this.n; i++) {
                this.test = true;
                this.star_x_save = this.star[i][3];
                this.star_y_save = this.star[i][4];
                this.star[i][0] += this.mouse_x >> 4;

                if (this.star[i][0] > this.x << 1) {
                    this.star[i][0] -= this.w << 1;
                    this.test = false;
                }
                if (this.star[i][0] < -this.x << 1) {
                    this.star[i][0] += this.w << 1;
                    this.test = false;
                }
                this.star[i][1] += this.mouse_y >> 4;
                if (this.star[i][1] > this.y << 1) {
                    this.star[i][1] -= this.h << 1;
                    this.test = false;
                }
                if (this.star[i][1] < -this.y << 1) {
                    this.star[i][1] += this.h << 1;
                    this.test = false;
                }

                this.star[i][2] -= this.star_speed;
                if (this.star[i][2] > this.z) {
                    this.star[i][2] -= this.z;
                    this.test = false;
                }
                if (this.star[i][2] < 0) {
                    this.star[i][2] += this.z;
                    this.test = false;
                }

                this.star[i][3] = this.x + (this.star[i][0] / this.star[i][2]) * this.star_ratio;
                this.star[i][4] = this.y + (this.star[i][1]