import { expect, test } from 'vitest'
import * as compiler from './compiler.js';

test('some test', async () => {
    const json = await compiler.getStoryData('hello world');
    console.log(json);
    const result = JSON.parse(json);
    expect(result.start).toBe("_default");
    //expect(result).toBe('hello world');
})