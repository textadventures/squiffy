import { expect, test } from 'vitest'
import * as compiler from './compiler.js';

test('some test', async () => {
    const result = await compiler.getJs('hello world', '');
    expect(result).toBe('hello world');
})