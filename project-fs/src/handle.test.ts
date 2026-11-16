import { runConformance } from "./test/conformance.js";
import { fakeRoot } from "./test/fake-fsa.js";
import { DirectoryHandleFileSystem } from "./handle.js";

// The File System Access adapter, over fake handles. The case-insensitive variant behaves like
// a folder on a macOS or Windows disk.
runConformance("DirectoryHandleFileSystem (case-sensitive handles)", async () => ({
    fs: new DirectoryHandleFileSystem(fakeRoot({}, "MyStory")),
}));

runConformance("DirectoryHandleFileSystem (case-insensitive handles, like macOS)", async () => ({
    fs: new DirectoryHandleFileSystem(fakeRoot({ caseInsensitive: true }, "MyStory")),
}));
