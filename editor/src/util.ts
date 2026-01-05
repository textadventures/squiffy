export function el<T>(id: string) {
    return document.getElementById(id) as T;
}