import type { AtomCommandResult } from "@e6tools/client-runtime/state/runtime";

export interface FileSaveCoordinatorOptions<A, E> {
  readonly debounceMs: number;
  readonly persist: (contents: string) => Promise<AtomCommandResult<A, E>>;
  readonly onPendingChange: (pending: boolean) => void;
  readonly onConfirmed: (contents: string) => void;
  /**
   * Runs before each write. Resolving false holds the save, and every later one, until
   * `release` or `discard`: the file changed on disk under an edit that was not saved yet.
   */
  readonly check?: ((contents: string) => Promise<boolean>) | undefined;
}

export class FileSaveCoordinator<A = unknown, E = unknown> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private latestContents = "";
  private latestRevision = 0;
  private confirmedRevision = 0;
  private lastChangeAt = 0;
  private saving = false;
  private disposed = false;
  private held = false;
  private skipCheck = false;

  constructor(private readonly options: FileSaveCoordinatorOptions<A, E>) {}

  change(contents: string): void {
    if (this.disposed) return;
    this.latestContents = contents;
    this.latestRevision += 1;
    this.lastChangeAt = Date.now();
    this.options.onPendingChange(true);
    if (!this.held) this.schedule(this.options.debounceMs);
  }

  /**
   * Save the held contents over the file as it is now. With `contents`, save those over it even
   * when this coordinator held nothing: a held edit kept from an earlier visit to the file.
   */
  release(contents?: string): void {
    if (this.disposed) return;
    if (contents !== undefined) {
      this.latestContents = contents;
      this.latestRevision += 1;
      this.lastChangeAt = Date.now();
      this.options.onPendingChange(true);
    } else if (!this.held) {
      return;
    }
    this.held = false;
    this.skipCheck = true;
    this.schedule(0);
  }

  /** Drop the held contents: the file on disk wins. False when nothing was held. */
  discard(): boolean {
    if (!this.held) return false;
    this.held = false;
    this.clearTimer();
    this.confirmedRevision = this.latestRevision;
    this.options.onPendingChange(false);
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    // A held save stays unwritten: writing it now would overwrite the change it was held for.
    if (this.latestRevision > 0 && !this.held) void this.persistLatest();
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persistLatest();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async persistLatest(): Promise<void> {
    if (this.saving || this.held || this.latestRevision === this.confirmedRevision) return;

    this.saving = true;
    const contents = this.latestContents;
    const revision = this.latestRevision;
    const skipCheck = this.skipCheck;
    this.skipCheck = false;
    if (!skipCheck && this.options.check && !(await this.options.check(contents))) {
      this.saving = false;
      this.held = true;
      return;
    }
    const result = await this.options.persist(contents);
    const succeeded = result._tag === "Success";
    if (succeeded) {
      this.confirmedRevision = revision;
      this.options.onConfirmed(contents);
    }

    this.saving = false;
    if (revision === this.latestRevision) {
      if (succeeded) this.options.onPendingChange(false);
      return;
    }

    const remainingDebounce = Math.max(
      0,
      this.options.debounceMs - (Date.now() - this.lastChangeAt),
    );
    if (this.disposed) {
      void this.persistLatest();
    } else {
      this.schedule(remainingDebounce);
    }
  }
}
