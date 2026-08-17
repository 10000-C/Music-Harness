import type { CurrentAuthoritySnapshot } from './current-authority.js';

export interface ProjectAuthorityAccess {
  readCleanCurrent(): Promise<CurrentAuthoritySnapshot>;
  getProjectPath(): string;
  runSerializedWrite<T>(operation: () => Promise<T>): Promise<T>;
}
