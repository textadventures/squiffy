// A question for the player, such as "Are you sure you want to restart?", in a dialog that looks
// like the rest of the page, in place of the browser's confirm()

export interface ConfirmDialogOptions {
    message: string;
    // The button that goes ahead, e.g. "Restart"
    confirm: string;
    // "Cancel" by default
    cancel?: string;
    // Whether going ahead loses something, which colours its button as a warning
    danger?: boolean;
    // Where the dialog goes in the page: the end of the body by default
    container?: HTMLElement;
}

let dialogCount = 0;

// Shows the question, and resolves true if the player goes ahead. Escape, Cancel and clicking
// outside the dialog all resolve false. The dialog is taken off the page once it's answered.
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    const id = `squiffy-confirm-${++dialogCount}`;
    const dialog = document.createElement("dialog");
    dialog.className = "squiffy-confirm";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-labelledby", `${id}-message`);
    dialog.innerHTML = `
        <p id="${id}-message"></p>
        <div class="squiffy-confirm-buttons">
            <button type="button" class="squiffy-confirm-button" data-answer="no"></button>
            <button type="button" class="squiffy-confirm-button ${options.danger ? "squiffy-confirm-danger" : "squiffy-confirm-primary"}" data-answer="yes"></button>
        </div>`;
    dialog.querySelector("p")!.textContent = options.message;
    const no = dialog.querySelector<HTMLButtonElement>("[data-answer=no]")!;
    const yes = dialog.querySelector<HTMLButtonElement>("[data-answer=yes]")!;
    no.textContent = options.cancel ?? "Cancel";
    yes.textContent = options.confirm;
    (options.container ?? document.body).appendChild(dialog);

    return new Promise<boolean>(resolve => {
        let answered = false;
        const finish = (answer: boolean) => {
            if (answered) return;
            answered = true;
            if (dialog.open) dialog.close();
            dialog.remove();
            resolve(answer);
        };
        no.addEventListener("click", () => finish(false));
        yes.addEventListener("click", () => finish(true));
        // Escape
        dialog.addEventListener("cancel", e => {
            e.preventDefault();
            finish(false);
        });
        dialog.addEventListener("close", () => finish(false));
        // A click on the backdrop is on the dialog itself, outside its content
        dialog.addEventListener("click", e => {
            if (e.target !== dialog) return;
            const rect = dialog.getBoundingClientRect();
            const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
            if (!inside) finish(false);
        });
        dialog.showModal();
        yes.focus();
    });
}
