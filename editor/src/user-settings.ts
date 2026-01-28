const get = (setting: string) => {
    const value = localStorage.getItem(setting);
    if (value === null) return null;
    return JSON.parse(value);
};

const set = (setting: string, value: any) => {
    localStorage.setItem(setting, JSON.stringify(value));
};

export interface TextBlock {
    name: string;
    content: string;
}

export const defaultSettings = {
    fontSize: 12,
    textBlocks: [] as TextBlock[]
};

export const initUserSettings = function () {
    const fontSize = getFontSize();
    if (!fontSize) {
        setFontSize(defaultSettings.fontSize);
    }
};

export const getFontSize = () => get("fontSize") || defaultSettings.fontSize;
export const setFontSize = (value: number) => set("fontSize", value);

export const getTextBlocks = () => get("textBlocks") || defaultSettings.textBlocks;
export const setTextBlocks = (value: TextBlock[]) => set("textBlocks", value);