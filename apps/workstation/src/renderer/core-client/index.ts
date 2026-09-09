export { FakeWorkstationCoreClient } from './fake-workstation-core-client.js';
export { dispatchCandidateRendererCommand } from './candidate-command-dispatcher.js';
export { projectCandidateEvents } from './candidate-event-projection.js';
export {
  FAKE_CANDIDATE_ID,
  FAKE_PROJECT_ID,
  FAKE_TASK_ID,
  fakeCoreFixtures,
  getFakeCoreFixture,
} from './fake-core-fixtures.js';
export {
  FAKE_CANDIDATE_PLAYBACK_REVISION,
  FAKE_CURRENT_PLAYBACK_REVISION,
} from './fake-composition-fixture.js';

export type { FakeCoreFixtureName } from './fake-core-fixtures.js';
export type {
  CoreEventListener,
  PlaybackBundle,
  WorkstationCoreClient,
} from './workstation-core-client.js';
