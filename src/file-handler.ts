export const openFile = async (onOpen: (data: string) => void) => {
    // TODO: Check for unsaved changes first

    // TODO: This only works on Chrome - Safari doesn't support window.showOpenFilePicker(), so we'll need to
    // get the File reference from an input element, see https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications
    const [fileHandle] = await window.showOpenFilePicker();
    const file = await fileHandle.getFile();
    const reader = new FileReader();
    reader.onload = (e) => {
        onOpen(e.target?.result as string);
    };
    reader.readAsText(file);
}