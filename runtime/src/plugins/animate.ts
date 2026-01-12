import { PluginHost, SquiffyPlugin } from "../types.plugins.js";
import Handlebars from "handlebars";
import * as marked from "marked";

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
            const isBlock = params.content.includes("\n\n");
            if (isBlock) {
                el.innerHTML = marked.parse(params.content, { async: false }).trim();
            } else {
                el.innerHTML = marked.parseInline(params.content, { async: false }).trim();
            }

            if (!params.name) {
                continue;
            }

            const runAnimation = () => {
                if (params.loop) {
                    squiffy.animation.runAnimation(params.name, el, params, () => {}, true);
                } else {
                    if (squiffy.animation.isInitiallyHidden(params.name)) {
                        el.style.opacity = "0";
                    }
                    squiffy.addTransition(() => {
                        return new Promise<void>((resolve) => {
                            const currentContent = el.innerHTML;

                            // Reset opacity so the animation can control visibility
                            el.style.opacity = "";

                            squiffy.animation.runAnimation(params.name, el, params, () => {
                                el.classList.remove("squiffy-animate");
                                el.innerHTML = currentContent;
                                resolve();
                            }, false);
                        });
                    });
                }
            };

            if (params.trigger === "link") {
                const links = el.querySelectorAll("a");
                for (const link of links) {
                    squiffy.animation.addLinkAnimation(link, runAnimation);
                }
            } else {
                runAnimation();
            }
        }
    };

    return {
        name: "animate",
        init(sq: PluginHost) {
            squiffy = sq;

            squiffy.registerHelper("animate", function(name: string, options) {
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

                const isBlock = content.includes("\n\n");
                const tag = isBlock ? "div" : "span";
                return new Handlebars.SafeString(`<${tag} class="squiffy-animate"${attrs}></${tag}>`);
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