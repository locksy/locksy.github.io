document.addEventListener("DOMContentLoaded", () => {
    gsap.registerPlugin(ScrollTrigger);

    gsap.from("header h1", { opacity: 0, y: -50, duration: 1 });
    gsap.from("header p", { opacity: 0, y: -20, duration: 1, delay: 0.5 });

    document.querySelectorAll("section").forEach((section, index) => {
        gsap.from(section, {
            scrollTrigger: {
                trigger: section,
                start: "top 80%",
                toggleActions: "play none none reverse"
            },
            opacity: 0,
            y: 50,
            duration: 1,
            delay: index * 0.2
        });
    });
});
