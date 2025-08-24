// TODO: This should take an array of strings instead of a colon-separated string
export function rotate(options: string, current: string | null) {
    const colon = options.indexOf(':');
    if (colon == -1) {
        return [options, current];
    }
    const next = options.substring(0, colon);
    let remaining = options.substring(colon + 1);
    if (current) remaining += ':' + current;
    return [next, remaining];
}