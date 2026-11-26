// Where the Share or publish dialog last sent each story, so it opens on the same choice next time: most
// authors publish a story the same way every time. Kept in this browser, by the story's ID in
// squiffy.json. A story without one opens on whatever was last chosen for any story.
export const PUBLISH_TARGETS = ["online", "link", "zip", "html", "js"] as const;
export type PublishTarget = typeof PUBLISH_TARGETS[number];

// The first choice for a story that hasn't been published from here: a link, which needs no
// account and no upload, and is what a newcomer sharing a story wants (#719)
export const DEFAULT_PUBLISH_TARGET: PublishTarget = "link";

const STORAGE_KEY = "squiffy-publish-targets";
// The key for the last choice made for any story
const LAST = "";

const isTarget = (value: unknown): value is PublishTarget => PUBLISH_TARGETS.includes(value as PublishTarget);

export function parsePublishTargets(text: string | null): Record<string, PublishTarget> {
    try {
        const parsed: unknown = JSON.parse(text ?? "{}");
        if (typeof parsed !== "object" || parsed === null) return {};
        return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, PublishTarget] => isTarget(entry[1])));
    } catch {
        return {};
    }
}

export function chooseTarget(targets: Record<string, PublishTarget>, storyId: string | undefined): PublishTarget {
    return (storyId && targets[storyId]) || targets[LAST] || DEFAULT_PUBLISH_TARGET;
}

export function withTarget(targets: Record<string, PublishTarget>, storyId: string | undefined, target: PublishTarget): Record<string, PublishTarget> {
    return { ...targets, [LAST]: target, ...(storyId ? { [storyId]: target } : {}) };
}

function read(): Record<string, PublishTarget> {
    try {
        return parsePublishTargets(localStorage.getItem(STORAGE_KEY));
    } catch {
        // Storage can be unavailable, e.g. in a private window
        return {};
    }
}

export function loadPublishTarget(storyId: string | undefined): PublishTarget {
    return chooseTarget(read(), storyId);
}

export function savePublishTarget(storyId: string | undefined, target: PublishTarget) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(withTarget(read(), storyId, target)));
    } catch {
        // Not remembered, which is all that's lost
    }
}
