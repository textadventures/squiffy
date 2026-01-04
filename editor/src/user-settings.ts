const get = (setting: string) => {
    const value = localStorage.getItem(setting);
    if (value === null) return null;
    return JSON.parse(value);
};

const set = (setting: string, value: any) => {
    localStorage.setItem(setting, JSON.stringify(value));
};

export const defaultSettings = {
    fontSize: 12
};

export const initUserSettings = function () {
    const fontSize = getFontSize();
    if (!fontSize) {
        setFontSize(defaultSettings.fontSize);
    }
};

export const getFontSize = () => get("fontSize");
export const setFontSize = (value: number) => set("fontSize", value);