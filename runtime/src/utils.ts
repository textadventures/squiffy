export function fadeReplace(element: HTMLElement, text: string): Promise<void> {
    return new Promise((resolve) => {
        element.addEventListener('transitionend', function () {
            element.innerHTML = text;

            element.addEventListener('transitionend', function () {
                element.classList.remove('fade-in');
                resolve();
            }, { once: true });

            element.classList.remove('fade-out');
            element.classList.add('fade-in');
        }, { once: true });

        element.classList.add('fade-out');
    });
}