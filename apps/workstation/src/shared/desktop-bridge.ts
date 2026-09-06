import type { ServiceKind } from '../main/b-contracts/service-lifecycle.js';
import type { ServiceFleetSnapshot } from './service-status.js';
import type {
  CommandResult,
  DirectoryDialogResult,
  ExportPathRequest,
  FileDialogResult,
  ProjectDirectoryPurpose,
} from './shell-contracts.js';
export interface DesktopBridge {
  getServiceSnapshot(): Promise<ServiceFleetSnapshot>;
  restartService(service: ServiceKind): Promise<CommandResult>;
  onServiceSnapshot(
    listener: (snapshot: ServiceFleetSnapshot) => void,
  ): () => void;
  chooseProjectDirectory(
    purpose: ProjectDirectoryPurpose,
  ): Promise<DirectoryDialogResult>;
  chooseExportPath(request: ExportPathRequest): Promise<FileDialogResult>;
}
declare global {
  interface Window {
    /** Present in Electron; absent in browser-only Renderer QA. */
    agentMusic?: DesktopBridge;
  }
}
