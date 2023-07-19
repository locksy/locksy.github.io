/*!
 * Percent-Preloader JS - v1
 * @author JDM Digital - https://jdmdigital.co
 * Copyright (c) 2022
 */
var counting = setInterval(function () {
	var loader = document.getElementById("percentage");
	var currval = parseInt(loader.innerHTML);
	var Width = 99 - currval;
	var loadscreen = document.getElementById("loader-progress");
	loader.innerHTML = ++currval;
	if (currval > 89){
		loader.innerHTML = 90;
		if(window.jQuery) {
			//console.log('jquery loaded');
			loader.innerHTML = 95;
			if(document.readyState == "interactive") {
				loader.innerHTML = 99;
			}
			if(document.readyState == "complete") {
				//console.log('fully loaded!');
				clearInterval(counting);
				loader.innerHTML = 100;
				jQuery("body").toggleClass('page-loaded');
				setTimeout(function() {
					jQuery('nav').css('visibility','visible')
				}, 880);
			}
		}
	} 
	
	loadscreen.style.transition = "0.15s";
	loadscreen.style.width = Width + "%";
}, 20);