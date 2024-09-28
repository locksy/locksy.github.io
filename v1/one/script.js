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
  
      // Mouse move event for desktop interaction
      window.addEventListener('mousemove', onMouseMove, false);
  
      // Initialize device orientation
      initializeDeviceOrientation();
    }
  
    function onWindowResize(event) {
      renderer.setSize(window.innerWidth, window.innerHeight);
      uniforms.resolution.value.x = renderer.domElement.width;
      uniforms.resolution.value.y = renderer.domElement.height;
    }
  
    function onMouseMove(event) {
      uniforms.mouse.value.x = event.clientX;
      uniforms.mouse.value.y = renderer.domElement.height - event.clientY;
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
      // Check if DeviceOrientationEvent is available
      if (window.DeviceOrientationEvent) {
        // For iOS 13+ devices
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
          console.log('DeviceOrientationEvent.requestPermission is available');
          $('#requestPermissionButton').show();
          $('#requestPermissionButton').on('click', function() {
            DeviceOrientationEvent.requestPermission()
              .then(function(response) {
                console.log('DeviceOrientationEvent.requestPermission response:', response);
                if (response === 'granted') {
                  $('#requestPermissionButton').hide();
                  window.addEventListener('deviceorientation', handleDeviceOrientation, false);
                } else {
                  alert('Permission not granted for Device Orientation');
                }
              })
              .catch(function(error) {
                console.error('Error requesting device orientation permission:', error);
              });
          });
        } else {
          // Non-iOS or older iOS versions
          console.log('DeviceOrientationEvent.requestPermission is not required');
          $('#requestPermissionButton').hide();
          window.addEventListener('deviceorientation', handleDeviceOrientation, false);
        }
      } else {
        console.log('DeviceOrientationEvent is not supported in your browser.');
        $('#requestPermissionButton').hide();
      }
    }
  
    function handleDeviceOrientation(event) {
      console.log('Device orientation event:', event);
      const gamma = event.gamma; // Left to right tilt in degrees, between -90 and 90
      const beta = event.beta;   // Front to back tilt in degrees, between -180 and 180
  
      // Normalize gamma and beta to values between 0 and window dimensions
      const x = ((gamma || 0) + 90) / 180 * window.innerWidth;
      const y = ((beta || 0) + 180) / 360 * window.innerHeight;
  
      uniforms.mouse.value.x = x;
      uniforms.mouse.value.y = renderer.domElement.height - y;
    }
  
    // Star Field Overlay
    (function($, window, document, undefined) {
      var Starfield = function(el, options) {
        this.el = el;
        this.$el = $(el);
        this.options = options;
  
        that = this;
      };
  
      var that;
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
          fps: 60,
          speed: 3,
          quantity: 512,
          ratio: 256,
          divclass: "starfield"
        },
  
        resizer: function() {
          // Resizer code...
          // (Same as your original code)
        },
  
        init: function() {
          // Initialization code...
          // (Same as your original code)
        },
  
        anim: function() {
          // Animation code...
          // (Same as your original code)
        },
  
        loop: function() {
          this.anim();
  
          animId = window.requestAnimationFrame(function() { that.loop(); });
        },
  
        move: function() {
          var doc = document.documentElement;
  
          if (this.orientationSupport && !this.desktop) {
            window.addEventListener('deviceorientation', handleOrientation, false);
          } else {
            window.addEventListener('mousemove', handleMousemove, false);
          }
  
          function handleOrientation(event) {
            if (event.beta !== null && event.gamma !== null) {
              var gamma = event.gamma; // Left to right tilt in degrees, between -90 and 90
              var beta = event.beta;   // Front to back tilt in degrees, between -180 and 180
  
              // Normalize gamma and beta to screen coordinates
              var x = ((gamma || 0) + 90) / 180 * that.w;
              var y = ((beta || 0) + 180) / 360 * that.h;
  
              that.cursor_x = x;
              that.cursor_y = y;
            }
          }
  
          function handleMousemove(event) {
            that.cursor_x = event.pageX || event.clientX + doc.scrollLeft - doc.clientLeft;
            that.cursor_y = event.pageY || event.clientY + doc.scrollTop - doc.clientTop;
          }
        },
  
        stop: function() {
          window.cancelAnimationFrame(animId);
  
          isPlaying = false;
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
  
          window.addEventListener('resize', function() { that.resizer(); }, false);
          window.addEventListener('orientationchange', function() { that.resizer(); }, false);
  
          if (this.settings.mouseMove) {
            this.move();
          }
  
          return this;
        }
      };
  
      Starfield.defaults = Starfield.prototype.defaults;
  
      $.fn.starfield = function(options) {
        return this.each(function() {
          new Starfield(this, options).start();
        });
      };
  
      window.Starfield = Starfield;
    })(jQuery, window, document);
  
    // Initialize the starfield
    $('.starfield').starfield();
  });
  