import type { ChildProcess } from 'node:child_process';

export interface ManagedProcessEntry {
  applyChain: Promise<void>;
  botInstanceId: string;
  child: ChildProcess;
  fatalRuntimeFailureHandled: boolean;
  forceKillTimer: ReturnType<typeof setTimeout> | null;
  terminalStoppedHandled: boolean;
  terminationRequested: boolean;
}

export class ProcessRegistry {
  private readonly entries = new Map<string, ManagedProcessEntry>();

  add(entry: ManagedProcessEntry) {
    this.entries.set(entry.botInstanceId, entry);
  }

  delete(botInstanceId: string) {
    this.entries.delete(botInstanceId);
  }

  deleteIfCurrent(entry: ManagedProcessEntry) {
    if (this.entries.get(entry.botInstanceId) !== entry) {
      return false;
    }

    return this.entries.delete(entry.botInstanceId);
  }

  get(botInstanceId: string) {
    return this.entries.get(botInstanceId) ?? null;
  }

  has(botInstanceId: string) {
    return this.entries.has(botInstanceId);
  }

  values() {
    return [...this.entries.values()];
  }
}
