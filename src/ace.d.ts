interface Window {
    ace: Ace;
}

interface Ace {
    require(string): any;
    edit(input: string): Ace;
    setFontSize(size: number): void;
    getValue(): string;
    getSelectedText(): string;
    session: any;
    selection: any;
    getSession(): any;
    renderer: any;
    focus(): void;
    resize(): void;
    $blockScrolling: number;
    setTheme(theme: string): void;
    setShowPrintMargin(value: boolean);
    on: any;
    commands: any;
    undo(): void;
    redo(): void;
    execCommand(command: string): void;
}