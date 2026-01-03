import {Output} from "squiffy-compiler";

export const getStoryFromCompilerOutput = function (data: Output) {
    const js = data.js.map(jsLines => new Function('squiffy', 'get', 'set', jsLines.join('\n')));
    return {
        js: js as any,
        ...data.story,
    };
};