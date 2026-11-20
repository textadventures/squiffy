import { init, confirmDialog } from "squiffy-runtime";
import "squiffy-runtime/squiffy.runtime.css";
import "./style.css";
import { story, title } from "./story/game.squiffy";

document.title = title;
document.getElementById("title")!.textContent = title;

const squiffy = await init({
    element: document.getElementById("squiffy")!,
    story,
});

const backButton = document.getElementById("back") as HTMLButtonElement;
backButton.addEventListener("click", () => squiffy.goBack());
squiffy.on("canGoBackChanged", event => backButton.disabled = !event.canGoBack);

document.getElementById("restart")!.addEventListener("click", async () => {
    if (await confirmDialog({ message: "Are you sure you want to restart?", confirm: "Restart" })) {
        squiffy.restart();
    }
});

await squiffy.begin();

// When you edit the story while running `npm run dev`, update it in place
// without losing the player's progress
if (import.meta.hot) {
    import.meta.hot.accept("./story/game.squiffy", module => {
        if (module) squiffy.update(module.story);
    });
}
