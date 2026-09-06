import type { ServiceKind } from '../shared/service-lifecycle.js';
import type { ServiceFleetSnapshot } from './service-status.js';
import type {
  CommandResult,
  DirectoryDialogResult,
  ExportPathRequest,
  FileDialogResult,
  ProjectDirectoryPurpose,
  ProjectCommandResult,
} from './shell-contracts.js';
import type { ProjectCommand } from '@agent-music/contracts';
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
  dispatchProject(command: ProjectCommand): Promise<ProjectCommandResult>;
}
declare global {
  interface Window {
    /** Present in Electron; absent in browser-only Renderer QA. */
    agentMusic?: DesktopBridge;
  }
}
