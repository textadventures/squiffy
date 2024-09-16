import { expect, test } from 'vitest'
import * as compiler from './compiler.js';

test('"Hello world" should compile', async () => {
    const result = await compiler.getStoryData('hello world');
    expect(result.story.start).toBe("_default");
    expect(Object.keys(result.story.sections).length).toBe(1);
    expect(result.story.sections._default.text).toBe("<p>hello world</p>");
})