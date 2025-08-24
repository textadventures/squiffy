import {HandleLinkResult} from "./types.plugins.js";

export class LinkHandler {
    linkHandlers: {[type: string]: (el: HTMLElement) => HandleLinkResult} = {};

    registerLinkHandler(type: string, handler: (el: HTMLElement) => HandleLinkResult) {
        this.linkHandlers[type] = handler;
    }

    handleLink(link: HTMLElement): [found: boolean, type: string, result: HandleLinkResult] {
        const type = link.getAttribute('data-handler') || '';
        const handler = this.linkHandlers[type];
        if (handler) {
            return [true, type, handler(link)];
        }
        return [false, type, null];
    }
}