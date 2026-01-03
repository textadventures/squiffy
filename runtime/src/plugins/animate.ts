import { PluginHost, SquiffyPlugin } from "../types.plugins.js";
import Handlebars from "handlebars";

export function AnimatePlugin(): SquiffyPlugin {
    let squiffy: PluginHost;

    const parseDataset = (dataset: DOMStringMap): Record<string, any> => {
        const result: Record<string, any> = {};

        for (const [key, value] of Object.entries(dataset)) {
            if (value == null) {
                result[key] = value;
                continue;
            }

            try {
                result[key] = JSON.parse(value);
            } catch {
                result[key] = value;
            }
        }

        return result;
    };

    const setupAnimations = (element: HTMLElement) => {
        const selector = ".squiffy-animate";
        for (const el of element.querySelectorAll<HTMLElement>(selector)) {
            const params = parseDataset(el.dataset);

            if (!params.content) {
                continue;
            }
            el.innerHTML = params.content;

            if (!params.name) {
                continue;
            }

            const runAnimation = () => {
                if (params.loop) {
                    squiffy.animation.runAnimation(params.name, el, params, () => {}, true);
                } else {
                    squiffy.addTransition(() => {
                        return new Promise<void>((resolve) => {
                            const currentContent = el.innerHTML;
                            squiffy.animation.runAnimation(params.name, el, params, () => {
                                el.classList.remove("squiffy-animate");
                                el.innerHTML = currentContent;
                                resolve();
                            }, false);
                        });
                    })
                }
            }

            if (params.trigger === "link") {
                const links = el.querySelectorAll("a");
                for (const link of links) {
                    squiffy.animation.addLinkAnimation(link, runAnimation);
                }
            } else {
                runAnimation();
            }
        }
    }

    return {
        name: "animate",
        init(sq: PluginHost) {
            squiffy = sq;

            squiffy.registerHelper("animate", (name: string, options) => {
                const content = options.fn(this);
                const dataset: Record<string, any> = {
                    name,
                    content,
                    ...options.hash,
                };

                const attrs = Object.entries(dataset)
                    .map(([key, value]) =>
                        ` data-${Handlebars.escapeExpression(key)}="${Handlebars.escapeExpression(JSON.stringify(value))}"`
                    )
                    .join("");

                return new Handlebars.SafeString(`<span class="squiffy-animate"${attrs}></span>`);
            });
        },
        onWrite(element: HTMLElement) {
            setupAnimations(element);
        },
        onLoad() {
            setupAnimations(squiffy.outputElement);
        }
    };
}