import { animate, splitText, stagger } from "animejs";

export type AnimationHandler = (el: HTMLElement, params: Record<string, any>, onComplete: () => void, loop: boolean) => void;

// Whether the player has asked their system to reduce motion. Not in jsdom, which has no
// matchMedia, so --play is the same either way.
export function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// How long typewriter and toast take to fade the whole text in, under reduced motion
const reducedMotionFade = 200;

// Typewriter and toast under reduced motion: the whole text fades in quickly, after the same
// start, so what comes after it still waits for it. A loop just shows the text.
function fadeInWhole(el: HTMLElement, params: Record<string, any>, onComplete: () => void, loop: boolean) {
    if (loop) return;
    animate(el, {
        opacity: [0, 1],
        easing: "linear",
        duration: reducedMotionFade,
        delay: params.start || 0,
        onComplete: onComplete
    });
}

export interface AnimationOptions {
    initiallyHidden?: boolean;
}

interface RegisteredAnimation {
    handler: AnimationHandler;
    options: AnimationOptions;
}

export class Animation {
    animations: {[name: string]: RegisteredAnimation} = {};
    linkAnimations = new Map<HTMLElement, () => void>();

    registerAnimation(name: string, handler: AnimationHandler, options: AnimationOptions = {}) {
        this.animations[name] = { handler, options };
    }

    isInitiallyHidden(name: string): boolean {
        return this.animations[name]?.options.initiallyHidden ?? false;
    }

    runAnimation(name: string, el: HTMLElement, params: Record<string, any>, onComplete: () => void, loop: boolean) {
        const animation = this.animations[name];
        if (animation) {
            // So a custom animation can do less, as the built-in ones do
            animation.handler(el, { ...params, reducedMotion: prefersReducedMotion() }, onComplete, loop);
        } else {
            console.warn(`No animation registered with name: ${name}`);
            onComplete();
        }
    }

    addLinkAnimation(link: HTMLElement, fn: () => void) {
        this.linkAnimations.set(link, fn);
    }

    removeLinkAnimation(link: HTMLElement) {
        this.linkAnimations.delete(link);
    }

    runLinkAnimation(link: HTMLElement) {
        const fn = this.linkAnimations.get(link);
        if (fn) {
            fn();
        }
    }

    constructor() {
        this.registerAnimation("typewriter", function(el, params, onComplete, loop) {
            if (params.reducedMotion) return fadeInWhole(el, params, onComplete, loop);

            // Each character in a span, inside a span for its word, so a line only breaks
            // between words: without the words, it could break anywhere, e.g. at the
            // apostrophe in "let's"
            const { chars } = splitText(el, { words: true, chars: true });

            const fadeDuration = params.fadeDuration || 100;   // ms fade-in per character
            const interval = params.interval || 100;           // ms between each character appearing

            animate(chars, {
                opacity: [0, 1],
                easing: "linear",
                duration: fadeDuration,
                delay: stagger(interval, { start: params.start || 0 }),
                loop: loop,
                onComplete: onComplete
            });
        }, { initiallyHidden: true });

        this.registerAnimation("toast", function(el, params, onComplete, loop) {
            if (params.reducedMotion) return fadeInWhole(el, params, onComplete, loop);

            const { words } = splitText(el, { words: true, chars: false });

            const fadeDuration = params.fadeDuration || 100;   // ms fade-in per word
            const interval = params.interval || 200;           // ms between each word appearing

            animate(words, {
                opacity: [0, 1],
                y: [
                    { to: ["100%", "0%"] },
                ],
                easing: "linear",
                duration: fadeDuration,
                delay: stagger(interval, { start: params.start || 0 }),
                loop: loop,
                onComplete: onComplete
            });
        }, { initiallyHidden: true });

        this.registerAnimation("fadeIn", function(el, params, onComplete, loop) {
            // A fade isn't motion, but one that repeats forever is left still, as pulse is
            if (params.reducedMotion && loop) return;

            const duration = params.duration || 500;   // ms for the fade

            animate(el, {
                opacity: [0, 1],
                easing: params.easing || "easeOutQuad",
                duration: duration,
                delay: params.start || 0,
                loop: loop,
                onComplete: onComplete
            });
        }, { initiallyHidden: true });

        this.registerAnimation("continue", function(el, params, onComplete) {
            // Make it look and behave like a link
            el.classList.add("squiffy-continue");

            const style = params.style || "pulse";
            let waveAnimation: ReturnType<typeof animate> | null = null;
            let chars: HTMLElement[] | null = null;

            if (params.reducedMotion) {
                // Still a link, but without the movement. The stylesheet stops the CSS styles'.
                if (style === "wave") el.classList.add("squiffy-continue-wave");
            } else if (style === "wave") {
                // Wave style needs JS animation - split into chars and animate opacity. Words too,
                // so a line only breaks between words, as with typewriter.
                el.classList.add("squiffy-continue-wave");
                const split = splitText(el, { words: true, chars: true });
                chars = split.chars as HTMLElement[];

                waveAnimation = animate(chars, {
                    opacity: [1, 0.3, 1],
                    easing: "easeInOutSine",
                    duration: 1200,
                    delay: stagger(80),
                    loop: true
                });
            } else {
                // CSS-based styles (pulse, glow, bounce)
                el.classList.add(`squiffy-continue-${style}`);
            }

            const handleClick = () => {
                el.classList.remove("squiffy-continue", "squiffy-continue-wave", `squiffy-continue-${style}`);
                el.removeEventListener("click", handleClick);

                if (waveAnimation) {
                    waveAnimation.pause();
                    // Restore chars to full opacity
                    if (chars) {
                        for (const char of chars) {
                            char.style.opacity = "1";
                        }
                    }
                }

                onComplete();
            };

            el.addEventListener("click", handleClick);
        });
    }
}