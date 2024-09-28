$(document).ready(function() {
    var starfield;
  
    (function($, window, document, undefined) {
      var Starfield = function(el, options) {
        this.el = el;
        this.$el = $(el);
        this.options = options;
  
        this.defaults = {
          starColor: "rgba(255,255,255,1)",
          bgColor: "rgba(0,0,0,1)",
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
  
        this.n = 0;
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.px = 0;
        this.py = 0;
        this.pz = 0;
        this.sz = 0;
        this.stars = [];
        this.ctx = null;
        this.w = 0;
        this.h = 0;
        this.cx = 0;
        this.cy = 0;
  
        this.init();
      };
  
      Starfield.prototype = {
        init: function() {
          this.w = window.innerWidth;
          this.h = window.innerHeight;
          this.cx = this.w / 2;
          this.cy = this.h / 2;
  
          this.createCanvas();
          this.createStars();
          this.registerEvents();
          this.start();
        },
  
        createCanvas: function() {
          var canvas = document.createElement("canvas");
          canvas.width = this.w;
          canvas.height = this.h;
          this.ctx = canvas.getContext("2d");
          this.$el.append(canvas);
        },
  
        createStars: function() {
          for (var i = 0; i < this.settings.quantity; i++) {
            this.stars.push({
              x: (Math.random() * this.w - this.cx) * this.settings.ratio,
              y: (Math.random() * this.h - this.cy) * this.settings.ratio,
              z: Math.round(Math.random() * this.settings.ratio)
            });
          }
        },
  
        registerEvents: function() {
          $(window).on("resize", this.resizeHandler.bind(this));
          if (this.settings.mouseMove) {
            $(document).on("mousemove", this.mousemoveHandler.bind(this));
          }
          this.initDeviceOrientation();
        },
  
        start: function() {
          this.loop();
        },
  
        loop: function() {
          this.ctx.fillStyle = this.settings.bgColor;
          this.ctx.fillRect(0, 0, this.w, this.h);
  
          for (var i = 0; i < this.stars.length; i++) {
            var s = this.stars[i];
  
            this.pz = s.z;
            s.z -= this.settings.speed;
  
            if (s.z <= 0) {
              s.z = this.settings.ratio;
            }
  
            this.px = s.x / s.z;
            this.py = s.y / s.z;
  
            this.ctx.fillStyle = this.settings.starColor;
            this.ctx.fillRect(
              this.cx + this.px,
              this.cy + this.py,
              this.pz > 1 ? 2 : 1,
              this.pz > 1 ? 2 : 1
            );
          }
  
          window.requestAnimationFrame(this.loop.bind(this));
        },
  
        resizeHandler: function() {
          this.w = window.innerWidth;
          this.h = window.innerHeight;
          this.cx = this.w / 2;
          this.cy = this.h / 2;
  
          this.ctx.canvas.width = this.w;
          this.ctx.canvas.height = this.h;
        },
  
        mousemoveHandler: function(e) {
          this.cx = e.clientX;
          this.cy = e.clientY;
        },
  
        initDeviceOrientation: function() {
          if (window.DeviceOrientationEvent) {
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
              $('#requestPermissionButton').show().on('click', function() {
                DeviceOrientationEvent.requestPermission()
                  .then(permissionState => {
                    if (permissionState === 'granted') {
                      $('#requestPermissionButton').hide();
                      window.addEventListener('deviceorientation', this.handleOrientation.bind(this));
                    } else {
                      alert('Permission to access device orientation was denied');
                    }
                  })
                  .catch(console.error);
              }.bind(this));
            } else {
              window.addEventListener('deviceorientation', this.handleOrientation.bind(this));
            }
          } else {
            console.log('Device orientation is not supported');
          }
        },
  
        handleOrientation: function(event) {
          var x = event.gamma; // In degree in the range [-90,90]
          var y = event.beta;  // In degree in the range [-180,180]
  
          // Because we don't want to have the device upside down
          // We constrain the x value to the range [-90,90]
          if (x > 90) { x = 90; }
          if (x < -90) { x = -90; }
  
          // To make computation easier we shift the range of 
          // x and y to [0,180]
          x += 90;
          y += 90;
  
          // Now we calculate the position of the mouse cursor
          this.cx = (x / 180) * this.w;
          this.cy = (y / 180) * this.h;
        }
      };
  
      $.fn.starfield = function(options) {
        return this.each(function() {
          new Starfield(this, options);
        });
      };
    })(jQuery, window, document);
  
    starfield = $(".starfield").starfield();
  });