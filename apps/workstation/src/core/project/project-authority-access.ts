import type { CurrentAuthoritySnapshot } from './current-authority.js';

export interface ProjectAuthorityAccess {
  readCleanCurrent(): Promise<CurrentAuthoritySnapshot>;
  runSerializedWrite<T>(operation: () => Promise<T>): Promise<T>;
}
