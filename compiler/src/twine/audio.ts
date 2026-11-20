// Converts Twine's sound to Squiffy's music and sound helpers (#444). Squiffy has two kinds of
// sound: music, which loops and carries on from one section to the next until it's changed, and
// sounds, which play once. A Twine track that's set to loop anywhere in the story is music, and
// any other is a sound.

import { quote, Unconvertible } from "./expression.js";
import type { PassageContext } from "./convert.js";

export interface StoryAudio {
    // Track name -> the file it plays
    files: Map<string, string>;
    // The tracks that loop
    looping: Set<string>;
}

// The file a track plays: the one the story gives it, or the track name itself if that looks
// like a file, such as "rain.mp3"
export function trackFile(audio: StoryAudio, track: string): string {
    const file = audio.files.get(track);
    if (file !== undefined) return file;
    if (/\.\w{2,4}$/.test(track)) return track;
    throw new Unconvertible(`a track ("${track}") that the story doesn't give a file for`);
}

// The best of a track's sources: MP3 plays in every browser
export function pickSource(sources: string[]): string | undefined {
    return sources.find(s => /\.mp3(\?|#|$)/i.test(s)) ?? sources[0];
}

export interface AudioAction {
    play: boolean;
    stop: boolean;
    loop: boolean;
    // How long a fade takes, in seconds, if it's not Squiffy's default
    fade?: number;
    volume?: number;
}

// What a track does, as Squiffy: {{music}}, {{stopmusic}}, {{sound}}, or nothing
export function audioHelper(ctx: PassageContext, raw: string, audio: StoryAudio, track: string, action: AudioAction): string {
    const looping = action.loop || audio.looping.has(track);
    const fade = action.fade === undefined ? "" : ` fade=${action.fade}`;
    if (action.stop) {
        if (looping) return `{{stopmusic${fade}}}`;
        ctx.story.note("audio-stop-sound", raw, "Squiffy can't stop a sound that plays once, only music (a track that loops), so these have been left out");
        return "";
    }
    if (!action.play) return "";
    const file = quote(trackFile(audio, track));
    if (looping) {
        if (action.volume !== undefined && action.volume != 1) {
            ctx.story.note("audio-music-volume", raw, "Squiffy plays music at full volume, so the music's volume has been left out");
        }
        return `{{music ${file}${fade}}}`;
    }
    const volume = action.volume !== undefined && action.volume != 1 ? ` volume=${Math.max(0, Math.min(1, action.volume))}` : "";
    return `{{sound ${file}${volume}}}`;
}

// A helper that can be a directive, @music or @sound, for the start of a passage, or null
export function audioDirective(helper: string): string | null {
    if (helper == "{{stopmusic}}") return "@music stop";
    const m = /^\{\{(music|sound) "([^"&{}]+)"\}\}$/.exec(helper);
    if (!m || m[2].trim() != m[2] || m[2] == "stop") return null;
    return `@${m[1]} ${m[2]}`;
}

// Audio helpers as directives where they can be, at the start of a passage
export function leadingAudio(out: string, state: { leading: boolean, directives: string[] }): string {
    if (!state.leading) return out;
    const helpers = out.match(/\{\{[^{}]*\}\}/g) ?? [];
    const directives = helpers.map(audioDirective);
    if (helpers.join("") != out || directives.some(d => d === null)) {
        state.leading = false;
        return out;
    }
    for (const directive of directives as string[]) {
        // Only the last @music counts, as in Harlowe stopping one track and playing another
        if (directive.startsWith("@music ")) {
            const earlier = state.directives.findIndex(d => d.startsWith("@music "));
            if (earlier != -1) state.directives.splice(earlier, 1);
        }
        state.directives.push(directive);
    }
    return "";
}
