$(function () {
  // Mobile friendly...
  var $hover = $(".background_overlay");
  
  $hover.on("touchstart", function () {
    $hover.is(":hover");
  });
  
  $hover.on("touchend", function () {
    $hover.not(":hover");
  });
});