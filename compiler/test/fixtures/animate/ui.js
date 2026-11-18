squiffy.registerAnimation('custom-animation', function(el, params, onComplete, loop) {
    // Based on the sample in the animejs docs: https://animejs.com/documentation/animation
    const { animate, stagger, text } = squiffy.import.animejs;

    const { chars } = text.split(el, { words: false, chars: true });

    animate(chars, {
        // Property keyframes
        y: [
            { to: '-2.75rem', ease: 'outExpo', duration: 600 },
            { to: 0, ease: 'outBounce', duration: 800, delay: 100 }
        ],
        // Property specific parameters
        rotate: {
            from: '-1turn',
            delay: 0
        },
        delay: stagger(50),
        ease: 'inOutCirc',
        loopDelay: 1000,
        loop: loop,
        onComplete: onComplete
    });
});
