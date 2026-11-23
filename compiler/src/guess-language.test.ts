import { describe, expect, test } from "vitest";
import { guessLanguage } from "./guess-language.js";

// Enough of a passage of prose to go on, written three times
const prose = (text: string) => [text, text, text].join("\n\n");

const samples: Record<string, string> = {
    en: "You wake up in a cold room with no windows. There is a door to the north and a table in the middle of the floor. On the table is a note, and it says that you have one hour to get out before they come back for you. What do you do now?",
    fr: "Vous vous réveillez dans une pièce froide et sans fenêtre. Il y a une porte au nord et une table au milieu de la pièce. Sur la table, une lettre dit que vous avez une heure pour sortir avant qu'ils ne reviennent. Que faites-vous maintenant ?",
    de: "Du wachst in einem kalten Raum ohne Fenster auf. Im Norden ist eine Tür und in der Mitte steht ein Tisch. Auf dem Tisch liegt ein Brief, und er sagt, dass du eine Stunde hast, um zu fliehen, bevor sie zurück sind. Was machst du jetzt?",
    es: "Te despiertas en una habitación fría y sin ventanas. Hay una puerta al norte y una mesa en el centro de la sala. En la mesa hay una nota que dice que tienes una hora para salir antes de que vuelvan por ti. ¿Qué haces ahora?",
    it: "Ti svegli in una stanza fredda e senza finestre. C'è una porta a nord e un tavolo al centro della stanza. Sul tavolo c'è un biglietto che dice che hai un'ora per uscire prima che tornino a prenderti. Che cosa fai adesso?",
    pt: "Você acorda em um quarto frio e sem janelas. Há uma porta ao norte e uma mesa no meio do quarto. Na mesa há um bilhete que diz que você tem uma hora para sair antes que eles voltem para te buscar. O que você faz agora?",
    nl: "Je wordt wakker in een koude kamer zonder ramen. Er is een deur aan de noordkant en een tafel in het midden van de kamer. Op de tafel ligt een briefje, en er staat dat je een uur hebt om weg te komen voordat ze terug zijn. Wat doe je nu?",
    ru: "Вы просыпаетесь в холодной комнате без окон. На севере есть дверь, а посреди комнаты стоит стол. На столе лежит записка, и в ней сказано, что у вас есть час, чтобы выбраться, пока они не вернулись. Что вы будете делать?",
    uk: "Ви прокидаєтеся в холодній кімнаті без вікон. На півночі є двері, а посеред кімнати стоїть стіл. На столі лежить записка, і в ній сказано, що у вас є година, щоб вибратися, поки вони не повернулися. Що ви робитимете?",
    bg: "Събуждате се в студена стая без прозорци. На север има врата, а в средата на стаята има маса. На масата има бележка, в която пише, че имате един час да излезете, преди да се върнат за вас. Какво ще направите сега?",
    el: "Ξυπνάς σε ένα κρύο δωμάτιο χωρίς παράθυρα. Υπάρχει μια πόρτα στα βόρεια και ένα τραπέζι στη μέση. Πάνω στο τραπέζι υπάρχει ένα σημείωμα.",
    ja: "あなたは窓のない冷たい部屋で目を覚ます。北に扉があり、部屋の真ん中に机がある。",
    zh: "你在一个没有窗户的冷房间里醒来。北边有一扇门，房间中间有一张桌子。",
    ko: "당신은 창문이 없는 차가운 방에서 깨어납니다. 북쪽에 문이 있고 방 한가운데에 탁자가 있습니다.",
};

describe("guessLanguage", () => {
    test.each(Object.entries(samples))("%s", (tag, text) => {
        expect(guessLanguage(prose(text))).toBe(tag);
    });

    test("too little text isn't a guess", () => {
        expect(guessLanguage(samples.en)).toBeUndefined();
        expect(guessLanguage("")).toBeUndefined();
    });

    test("a language it doesn't know isn't taken for one it does", () => {
        // Czech
        expect(guessLanguage(prose("Probudíš se ve studené místnosti bez oken. Na severu jsou dveře a uprostřed místnosti stojí stůl. Na stole leží dopis, který říká, že máš hodinu na útěk, než se vrátí. Co uděláš teď?"))).toBeUndefined();
    });

    test("a few words in another script don't count, and nor do marks used for decoration", () => {
        expect(guessLanguage(prose(samples.en + " Its name is 東京."))).toBe("en");
        expect(guessLanguage(prose(samples.es.replace(/a/g, "a҉")))).toBe("es");
    });
});
