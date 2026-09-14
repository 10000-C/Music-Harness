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
  CandidateStateResult,
  PlaybackSnapshotResult,
  DesktopAgentCommandResult,
} from './shell-contracts.js';
import type {
  CorePlaybackResponse,
  PlaybackSnapshotSource,
} from './playback-bridge.js';
import type { CoreCandidateEventNotification } from './candidate-bridge.js';
import type { LiveOperationBridge } from './operation-bridge.js';
import type {
  AgentCommand,
  AgentEvent,
  CandidateCommand,
  ProjectId,
  ProjectCommand,
} from '@agent-music/contracts';
export interface DesktopBridge extends LiveOperationBridge {
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
  readCandidateState(projectId: ProjectId): Promise<CandidateStateResult>;
  onCandidateEvent(
    listener: (notification: CoreCandidateEventNotification) => void,
  ): () => void;
  dispatchAgent(command: AgentCommand): Promise<DesktopAgentCommandResult>;
  onAgentEvent(listener: (event: AgentEvent) => void): () => void;
  readCurrentPlayback(): Promise<CorePlaybackResponse | null>;
  readPlaybackSnapshot(
    projectId: ProjectId,
    source: PlaybackSnapshotSource,
  ): Promise<PlaybackSnapshotResult>;
}
declare global {
  interface Window {
    /** Present in Electron; absent in browser-only Renderer QA. */
    agentMusic?: DesktopBridge;
  }
}
