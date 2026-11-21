// Confetti for the ending. With squiffy.json, a .js file in the story's folder is added to the
// published page, like this one.
//
// The ending's @class confetti puts the "confetti" class on the story while it's on the screen.
// When it appears, a burst of confetti falls down the page, behind the text: pieces of paper, each
// its own colour, size, speed, sway and spin. Going back or restarting stops it. It doesn't run for
// a player who has asked for reduced motion.

(() => {
    const COLOURS = ["#ffd23f", "#ff5d5d", "#3ff2ff", "#ff8adf", "#7dff9b", "#ffffff"];
    const PIECES = 160;
    // How long new pieces keep coming from the top, before the last of them fall away
    const RAINING_FOR = 6000;

    let canvas = null;
    let frame = 0;
    let resize = null;

    const random = (min, max) => min + Math.random() * (max - min);

    function start() {
        if (canvas || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        canvas = document.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
        // Behind the story's text and the header, in front of the page's background
        canvas.style.cssText = "position: fixed; inset: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none;";
        document.body.appendChild(canvas);
        const context = canvas.getContext("2d");

        let width = 0;
        let height = 0;
        resize = () => {
            const scale = window.devicePixelRatio || 1;
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width * scale;
            canvas.height = height * scale;
            context.setTransform(scale, 0, 0, scale, 0, 0);
        };
        resize();
        window.addEventListener("resize", resize);

        // Spread out above the top of the window, so they arrive over a second or two
        const newPiece = (above) => ({
            x: random(0, width),
            y: above ? random(-height, -20) : -20,
            w: random(6, 11),
            h: random(10, 18),
            fall: random(70, 170),        // pixels a second
            sway: random(20, 60),         // pixels either side
            swaySpeed: random(1, 3),      // radians a second
            phase: random(0, Math.PI * 2),
            angle: random(0, Math.PI * 2),
            spin: random(-4, 4),          // radians a second
            flip: random(3, 8),           // how fast it turns over, so it catches the light
            colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
        });
        const pieces = Array.from({ length: PIECES }, () => newPiece(true));

        const started = performance.now();
        let last = started;
        const draw = (now) => {
            const seconds = Math.min(now - last, 100) / 1000;
            last = now;
            const raining = now - started < RAINING_FOR;
            context.clearRect(0, 0, width, height);
            let onScreen = 0;
            for (const piece of pieces) {
                piece.y += piece.fall * seconds;
                piece.phase += piece.swaySpeed * seconds;
                piece.angle += piece.spin * seconds;
                if (piece.y > height + 20) {
                    if (!raining) continue;
                    Object.assign(piece, newPiece(false));
                }
                onScreen++;
                const t = now / 1000;
                context.save();
                context.translate(piece.x + Math.sin(piece.phase) * piece.sway, piece.y);
                context.rotate(piece.angle);
                context.scale(Math.cos(t * piece.flip + piece.phase), 1);
                context.fillStyle = piece.colour;
                context.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
                context.restore();
            }
            if (onScreen) frame = requestAnimationFrame(draw);
            else stop();
        };
        frame = requestAnimationFrame(draw);
    }

    function stop() {
        cancelAnimationFrame(frame);
        window.removeEventListener("resize", resize);
        canvas?.remove();
        canvas = null;
    }

    // Starts when something on the page gets the confetti class, and stops when it's gone. Once
    // the last piece has fallen, it doesn't start again until the class goes and comes back.
    let showing = false;
    const check = () => {
        const now = !!document.querySelector(".confetti");
        if (now && !showing) start();
        if (!now && showing) stop();
        showing = now;
    };
    new MutationObserver(check).observe(document.documentElement, { attributes: true, attributeFilter: ["class"], subtree: true });
    check();
})();
