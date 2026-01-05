import { set } from "idb-keyval";

let fileHandle: FileSystemFileHandle;
let onOpen: (data: string) => void;

export const setOnOpen = (fn: (data: string) => void) => {
    onOpen = fn;
};

export const openFile = async () => {
    // TODO: Check for unsaved changes first

    // TODO: This only works on Chrome - Safari doesn't support window.showOpenFilePicker(), so we'll need to
    // get the File reference from an input element, see https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications
    [fileHandle] = await window.showOpenFilePicker();
    set("lastFileHandle", fileHandle);
    await openFileHandle();
};

const openFileHandle = async() => {
    const file = await fileHandle.getFile();
    const reader = new FileReader();
    reader.onload = (e) => {
        onOpen(e.target?.result as string);
    };
    reader.readAsText(file);
};

export const saveFile = async (data: string) => {
    // TODO: Won't have a fileHandle if we've refreshed and data was loaded from local storage.
    // Or, if we've not saved the file at all yet.
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
};