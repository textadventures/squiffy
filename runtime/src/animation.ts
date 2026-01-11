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
    }
}