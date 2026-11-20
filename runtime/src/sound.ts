// Music and sound effects (#444). The music playing is the _music attribute, so going back,
// loading a saved game and restarting all put it back as it was: the runtime calls sync() after
// each of those, and after anything that sets it. Sound effects play once, and aren't kept.

export type AudioUrlResolver = (path: string) => string;

export interface SoundOptions {
    // Turns a file in the story's folder into the URL to play it from
    resolveUrl: AudioUrlResolver;
    // The music that should be playing: the _music attribute
    getMusic: () => string | null;
    // Where mute is remembered, if anywhere
    mutedKey?: string;
    // Something started playing, or would have if the player hadn't muted it
    onPlay?: () => void;
}

// How long music takes to fade out when it's changed or stopped, and to fade in, unless
// fade= says otherwise
export const DEFAULT_FADE = 1;

const FADE_STEP_MS = 50;

interface Track {
    file: string;
    audio: HTMLAudioElement;
    fadeTimer?: ReturnType<typeof setInterval>;
}

export class Sound {
    private music: Track | null = null;
    private effects = new Set<HTMLAudioElement>();
    private preloaded = new Map<string, HTMLAudioElement>();
    private muted = false;
    // Browsers don't play sound until the player has clicked or pressed a key on the page, so
    // music that was refused is started again then
    private waitingForGesture = false;
    private disposed = false;

    constructor(private options: SoundOptions) {
        this.muted = this.readMuted();
    }

    // Starts loading files before they're needed, so they play straight away
    preload(files: string[]) {
        if (typeof Audio === "undefined") return;
        for (const file of files) {
            if (this.preloaded.has(file)) continue;
            const audio = new Audio();
            audio.preload = "auto";
            audio.src = this.options.resolveUrl(file);
            this.preloaded.set(file, audio);
        }
    }

    // Makes the music playing match the _music attribute. Music that's already playing carries on.
    sync(fade = DEFAULT_FADE) {
        if (this.disposed) return;
        const file = this.options.getMusic() || null;
        if (file === (this.music?.file ?? null)) return;
        this.stopMusic(fade);
        if (file) this.startMusic(file, fade);
    }

    // Plays a sound once
    play(file: string, volume = 1) {
        if (this.disposed || typeof Audio === "undefined") return;
        const audio = this.newAudio(file);
        audio.volume = clampVolume(volume);
        this.effects.add(audio);
        const done = () => this.effects.delete(audio);
        audio.addEventListener("ended", done);
        audio.addEventListener("error", done);
        this.options.onPlay?.();
        // A sound refused before the player has done anything is lost: it would be out of place later
        audio.play()?.catch(done);
    }

    // Stops the sounds playing once. Music carries on.
    stopSounds() {
        for (const audio of this.effects) audio.pause();
        this.effects.clear();
    }

    isMuted() {
        return this.muted;
    }

    setMuted(muted: boolean) {
        this.muted = muted;
        if (this.music) this.music.audio.muted = muted;
        for (const audio of this.effects) audio.muted = muted;
        this.writeMuted();
    }

    // Stops everything, for good: the story is being replaced
    dispose() {
        this.disposed = true;
        this.stopMusic(0);
        this.stopSounds();
        this.removeGestureListeners();
    }

    private newAudio(file: string) {
        const audio = new Audio(this.options.resolveUrl(file));
        audio.muted = this.muted;
        return audio;
    }

    private startMusic(file: string, fade: number) {
        if (typeof Audio === "undefined") return;
        const audio = this.newAudio(file);
        audio.loop = true;
        const track: Track = { file, audio };
        this.music = track;
        this.options.onPlay?.();
        audio.volume = fade > 0 ? 0 : 1;
        this.playTrack(track, fade);
    }

    private playTrack(track: Track, fade: number) {
        const played = track.audio.play();
        if (fade > 0) this.fade(track, 1, fade);
        played?.catch((error: unknown) => {
            if (track === this.music && (error as { name?: string })?.name == "NotAllowedError") {
                this.waitForGesture();
            }
        });
    }

    private stopMusic(fade: number) {
        const track = this.music;
        if (!track) return;
        this.music = null;
        if (fade > 0 && !track.audio.paused) {
            this.fade(track, 0, fade, () => track.audio.pause());
        }
        else {
            clearInterval(track.fadeTimer);
            track.audio.pause();
        }
    }

    // Changes a track's volume to `to` over `seconds`
    private fade(track: Track, to: number, seconds: number, then?: () => void) {
        clearInterval(track.fadeTimer);
        const from = track.audio.volume;
        const steps = Math.max(1, Math.round(seconds * 1000 / FADE_STEP_MS));
        let step = 0;
        track.fadeTimer = setInterval(() => {
            step++;
            track.audio.volume = clampVolume(from + (to - from) * step / steps);
            if (step >= steps) {
                clearInterval(track.fadeTimer);
                track.fadeTimer = undefined;
                then?.();
            }
        }, FADE_STEP_MS);
    }

    private readonly onGesture = () => {
        this.removeGestureListeners();
        const track = this.music;
        if (track && track.audio.paused) {
            track.audio.volume = 1;
            this.playTrack(track, 0);
        }
    };

    private waitForGesture() {
        if (this.waitingForGesture || typeof document === "undefined") return;
        this.waitingForGesture = true;
        // Capturing, so it's before a link click that might change the music
        document.addEventListener("pointerdown", this.onGesture, true);
        document.addEventListener("keydown", this.onGesture, true);
    }

    private removeGestureListeners() {
        if (!this.waitingForGesture) return;
        this.waitingForGesture = false;
        document.removeEventListener("pointerdown", this.onGesture, true);
        document.removeEventListener("keydown", this.onGesture, true);
    }

    private readMuted() {
        if (!this.options.mutedKey) return false;
        try {
            return localStorage.getItem(this.options.mutedKey) == "true";
        }
        catch {
            return false;
        }
    }

    private writeMuted() {
        if (!this.options.mutedKey) return;
        try {
            if (this.muted) localStorage.setItem(this.options.mutedKey, "true");
            else localStorage.removeItem(this.options.mutedKey);
        }
        catch {
            // It just isn't remembered
        }
    }
}

const clampVolume = (volume: number) => Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
