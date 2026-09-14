import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { CandidateCleanupManager } from '../../../workstation/src/core/candidate/candidate-cleanup.js';
import { CandidateGitRepository } from '../../../workstation/src/core/candidate/candidate-repository.js';
import { CandidateTransaction } from '../../../workstation/src/core/candidate/candidate-transaction.js';
import { CompositionPipeline } from '../../../workstation/src/core/composition/index.js';
import { MusicCoreMcpHttpServer } from '../../../workstation/src/core/mcp/music-core-mcp-server.js';
import { MusicCoreToolHost } from '../../../workstation/src/core/mcp/music-core-tool-host.js';
import { ProjectFoundation } from '../../../workstation/src/core/project/project-foundation.js';
import { createTemporaryDirectory } from '../../../workstation/src/core/project/test-support.js';
import { HttpTaskRollback } from './http-task-rollback.js';
import { RuntimeDescriptorDiscovery } from './runtime-descriptor.js';

const mcpServers: MusicCoreMcpHttpServer[] = [];
const foundations: ProjectFoundation[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(mcpServers.splice(0).map((server) => server.stop()));
  await Promise.all(
    foundations.splice(0).map((foundation) => foundation.closeProject()),
  );
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('HttpTaskRollback against a real Core MCP server', () => {
  it('rolls back a real Active Task through the control endpoint', async () => {
    const parent = await createTemporaryDirectory('agent-rollback-e2e-');
    tempDirectories.push(parent);
    const projectPath = join(parent, 'project');
    const foundation = new ProjectFoundation();
    foundations.push(foundation);
    const opened = await foundation.createProject(projectPath);

    const repository = new CandidateGitRepository();
    const transaction = new CandidateTransaction({
      project: foundation,
      composition: new CompositionPipeline(),
      repository,
      cleanup: new CandidateCleanupManager(repository),
      createId: (() => {
        let call = 0;
        return () => {
          call += 1;
          // First call is the candidate ID, second is the task ID.
          if (call === 1) {
            return '80000000-0000-4000-8000-000000000001';
          }
          if (call === 2) {
            return '80000000-0000-4000-8000-000000000002';
          }
          return randomUUID();
        };
      })(),
      now: () => new Date().toISOString(),
    });
    const runtimeDirectory = await mkdtemp(
      join(tmpdir(), 'agent-rollback-runtime-'),
    );
    tempDirectories.push(runtimeDirectory);
    const server = new MusicCoreMcpHttpServer({
      resolveProjectId: () => foundation.getProjectId(),
      runtimeDirectory,
      toolHost: new MusicCoreToolHost({
        agent: transaction,
        control: transaction,
        generationPlanConfirmation: {
          request: () => Promise.resolve('approved'),
        },
        scopeExtensionConfirmation: {
          request: () => Promise.resolve('approved'),
        },
      }),
      control: transaction,
      createToken: () => 'rollback-e2e-token',
    });
    mcpServers.push(server);
    await server.start();

    // Bootstrap a real Active Task directly through the A3 transaction.
    const task = await transaction.startTask({
      projectId: opened.projectId,
      scope: { type: 'wholeProject', trackIds: ['track.drums'] },
    });

    const rollback = new HttpTaskRollback({
      descriptors: new RuntimeDescriptorDiscovery(runtimeDirectory),
    });

    // A non-existent task id must surface the stable A3 error, proving the
    // request reached the real CandidateTransaction through HTTP.
    await expect(
      rollback.cancelTask({
        projectId: opened.projectId,
        candidateId: '90000000-0000-4000-8000-000000000001',
        taskId: '90000000-0000-4000-8000-000000000002',
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });

    // Rolling back the real Active Task succeeds. The first Task carries no
    // checkpoint, so A3 also tears down the Candidate workspace.
    await expect(
      rollback.cancelTask({
        projectId: opened.projectId,
        candidateId: task.candidateId,
        taskId: task.taskId,
      }),
    ).resolves.toEqual({ ok: true });

    // After rollback the Candidate is gone; a repeat surfaces the stable
    // A3 not-found error rather than silently succeeding.
    await expect(
      rollback.cancelTask({
        projectId: opened.projectId,
        candidateId: task.candidateId,
        taskId: task.taskId,
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });
  });
});
