import { animate, stagger, text } from "animejs";

export type AnimationHandler = (el: HTMLElement, params: Record<string, any>, onComplete: () => void, loop: boolean) => void;

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
            animation.handler(el, params, onComplete, loop);
        } else {
            console.warn(`No animation registered with name: ${name}`);
            onComplete();
        }
    }

    addLinkAnimation(link: HTMLElement, fn: () => void) {
        this.linkAnimations.set(link, fn);
    }

    runLinkAnimation(link: HTMLElement) {
        const fn = this.linkAnimations.get(link);
        if (fn) {
            fn();
        }
    }

    constructor() {
        this.registerAnimation("typewriter", function(el, params, onComplete, loop) {
            const { chars } = text.split(el, { words: false, chars: true });

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
            const { words } = text.split(el, { words: true, chars: false });

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

            if (style === "wave") {
                // Wave style needs JS animation - split into chars and animate opacity
                el.classList.add("squiffy-continue-wave");
                const split = text.split(el, { words: false, chars: true });
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