import { expect, test } from 'vitest'
import * as compiler from './compiler.js';

test('some test', async () => {
    const result = await compiler.getStoryData('hello world');
    expect(result.story.start).toBe("_default");
})