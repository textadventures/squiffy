import {animate, stagger, text} from "animejs";

export class Animation {
    animations: {[name: string]: (el: HTMLElement, params: Record<string, any>, onComplete: () => void, loop: boolean) => void} = {};

    registerAnimation(name: string, handler: (el: HTMLElement, params: Record<string, any>, onComplete: () => void, loop: boolean) => void) {
        this.animations[name] = handler;
    }

    runAnimation(name: string, el: HTMLElement, params: Record<string, any>, onComplete: () => void, loop: boolean) {
        const animation = this.animations[name];
        if (animation) {
            animation(el, params, onComplete, loop);
        } else {
            console.warn(`No animation registered with name: ${name}`);
            onComplete();
        }
    }

    constructor() {
        this.registerAnimation('typewriter', function(el, params, onComplete, loop) {
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
        });

        this.registerAnimation('toast', function(el, params, onComplete, loop) {
            const { words } = text.split(el, { words: true, chars: false });

            const fadeDuration = params.fadeDuration || 100;   // ms fade-in per word
            const interval = params.interval || 200;           // ms between each word appearing

            animate(words, {
                opacity: [0, 1],
                y: [
                    { to: ['100%', '0%'] },
                ],
                easing: "linear",
                duration: fadeDuration,
                delay: stagger(interval, { start: params.start || 0 }),
                loop: loop,
                onComplete: onComplete
            });
        });
    }
}