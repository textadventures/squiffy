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
            // The content is stored unrendered in data-content, so asset URLs in it haven't been
            // resolved yet. On load it's rendered again, so it picks up the current resolver.
            const isBlock = params.content.includes("\n\n");
            const html = isBlock
                ? marked.parse(params.content, { async: false })
                : marked.parseInline(params.content, { async: false });
            el.innerHTML = squiffy.resolveAssetsInHtml(html.trim());

            if (!params.name) {
                continue;
            }

            // Capture content now, before setupInputValidation modifies the links
            // with validation-disabled classes. This ensures when we restore the
            // innerHTML after animation, users can still interact with the links.
            const originalContent = el.innerHTML;

            // For trigger="link", the links in el that run the animation when clicked.
            let triggerLinks: HTMLElement[] = [];
            const registerTriggerLinks = () => {
                for (const link of triggerLinks) {
                    squiffy.animation.removeLinkAnimation(link);
                }
                triggerLinks = [...el.querySelectorAll<HTMLElement>("a")];
                for (const link of triggerLinks) {
                    squiffy.animation.addLinkAnimation(link, runAnimation);
                }
            };

            const restoreContent = () => {
                if (params.trigger !== "link") {
                    el.innerHTML = originalContent;
                    return;
                }

                // Restoring the content replaces the links, so carry over the state
                // (e.g. "disabled" from the click that triggered the animation) to the new
                // links, and make sure they still trigger the animation if re-enabled.
                const oldLinks = triggerLinks;
                el.innerHTML = originalContent;
                registerTriggerLinks();
                triggerLinks.forEach((link, i) => {
                    const oldLink = oldLinks[i];
                    if (!oldLink) return;
                    if (oldLink.classList.contains("disabled")) {
                        link.classList.add("disabled");
                    }
                    // tabindex, and which click or {{deactivate}} disabled it, so going back
                    // enables the right links
                    for (const attr of ["tabindex", "data-clicked", "data-deactivated-by"]) {
                        const value = oldLink.getAttribute(attr);
                        if (value !== null) {
                            link.setAttribute(attr, value);
                        }
                    }
                });
            };

            const runAnimation = () => {
                if (params.loop) {
                    squiffy.animation.runAnimation(params.name, el, params, () => {}, true);
                } else {
                    if (squiffy.animation.isInitiallyHidden(params.name)) {
                        el.style.opacity = "0";
                    }
                    squiffy.addTransition(() => {
                        return new Promise<void>((resolve) => {
                            // Reset opacity so the animation can control visibility
                            el.style.opacity = "";

                            squiffy.animation.runAnimation(params.name, el, params, () => {
                                el.classList.remove("squiffy-animate");
                                restoreContent();
                                resolve();
                            }, false);
                        });
                    });
                }
            };

            if (params.trigger === "link") {
                registerTriggerLinks();
            } else {
                runAnimation();
            }
        }
    };

    return {
        name: "animate",
        init(sq: PluginHost) {
            squiffy = sq;

            squiffy.registerHelper("animate", function(this: any, name: string, options) {
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