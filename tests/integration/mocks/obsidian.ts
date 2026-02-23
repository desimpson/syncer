// Minimal test stub for the Obsidian API used in unit tests.
// Provides runtime exports so Vite can resolve the 'obsidian' module during tests.

export class Notice {
  public message: string;
  public constructor(message = "") {
    this.message = message;
  }
}

// Lightweight types/classes so imports type-check in tests
export type TFile = {
  path: string;
  name?: string;
  vault?: unknown;
};

export type Vault = {
  getFileByPath: (path: string) => TFile | null | undefined;
  cachedRead?: (file: TFile) => Promise<string>;
  process?: (file: TFile, processor: (content: string) => string) => Promise<string>;
  modify?: (file: TFile, data: string) => Promise<void>;
};

// Stubs for UI classes if ever imported in tests (not used currently)
export class Plugin {
  public manifest: { name: string; id: string; version: string };
  public app: unknown;
  // minimal base class
  public constructor(app: unknown, manifest: { name: string; id: string; version: string }) {
    this.app = app;
    this.manifest = manifest;
  }
  public async loadData(): Promise<unknown> {
    return {};
  }
  public async saveData(_data: unknown): Promise<void> {
    // no-op
  }
  public addCommand(_command: unknown): void {
    // no-op
  }
  public addSettingTab(_tab: unknown): void {
    // no-op
  }
  public registerEvent(_event: { off: () => void }): void {
    // no-op
  }
}
export class PluginSettingTab {
  // minimal base class
  public containerEl: HTMLElement = {} as HTMLElement;
}
export class Modal {
  // minimal base class used by AuthCodeModal
  public app: unknown;
  public contentEl: { createEl: (..._arguments: unknown[]) => void; empty: () => void };
  public constructor(app?: unknown) {
    this.app = app;
    this.contentEl = {
      createEl: () => undefined,
      empty: () => undefined,
    };
  }
  // lifecycle hooks (no-op in tests)
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public onOpen(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  public onClose(): void {}
  public open(): void {
    this.onOpen();
  }
  public close(): void {
    this.onClose();
  }
}
export class Setting {
  // minimal base class
  public controlEl: HTMLElement = {} as HTMLElement;
  public descEl: HTMLElement = {
    createDiv: () => ({
      setText: (_text: string) => undefined,
    }),
  } as unknown as HTMLElement;
  public setName(_name: string): this {
    return this;
  }
  public setDesc(_desc: string): this {
    return this;
  }
  public setHeading(): this {
    return this;
  }
  public addButton(_callback: (_button: unknown) => unknown): this {
    return this;
  }
}
export class TextComponent {
  public setPlaceholder(): void {
    // no-op
  }
  public setValue(): void {
    // no-op
  }
  public onChange(): void {
    // no-op
  }
  public get inputEl(): HTMLInputElement {
    return {} as HTMLInputElement;
  }
}
