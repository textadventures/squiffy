// The rules for turning attribute values into numbers, shared by everything that does arithmetic:
// the maths helpers ({{add}}, {{sub}} etc., which infix arithmetic is rewritten to), {{inc}} and
// {{dec}}, and @set's +=, -=, *= and /= (which @inc and @dec compile to).
//
// Attributes often hold numbers as text: values from user input, {{set "x" "5"}}, or JavaScript.
// So text that's a number counts as that number. A blank value (unset, null, false or "") counts
// as 0, so a counter can start from nothing. Anything else is an error, rather than giving NaN or
// joining text together.

export const isBlank = (v: unknown) => v === undefined || v === null || v === false || v === "";

export const isNumeric = (v: unknown) =>
    typeof v === "number" || isBlank(v) || (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)));

// "what" names the operation in the error, e.g. "inc" gives: "inc" needs numbers, but was given "abc"
export function toNumber(what: string, v: unknown): number {
    if (!isNumeric(v)) {
        throw new Error(`"${what}" needs numbers, but was given ${JSON.stringify(v)}`);
    }
    return isBlank(v) ? 0 : Number(v);
}
