import type { ServiceKind } from '../shared/service-lifecycle.js';
import type { ServiceFleetSnapshot } from './service-status.js';
import type {
  CommandResult,
  DirectoryDialogResult,
  ExportPathRequest,
  FileDialogResult,
  ProjectDirectoryPurpose,
  ProjectCommandResult,
  CandidateCommandResult,
  DesktopAgentCommandResult,
} from './shell-contracts.js';
import type { CorePlaybackResponse } from './playback-bridge.js';
import type {
  AgentCommand,
  AgentEvent,
  CandidateCommand,
  ProjectCommand,
} from '@agent-music/contracts';
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
  dispatchCandidate(command: CandidateCommand): Promise<CandidateCommandResult>;
  dispatchAgent(command: AgentCommand): Promise<DesktopAgentCommandResult>;
  onAgentEvent(listener: (event: AgentEvent) => void): () => void;
  readCurrentPlayback(): Promise<CorePlaybackResponse | null>;
}
declare global {
  interface Window {
    /** Present in Electron; absent in browser-only Renderer QA. */
    agentMusic?: DesktopBridge;
  }
}
