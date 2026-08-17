export interface ProjectLockOwnership {
  assertOwned(): Promise<void>;
}

export class ProjectWriteCoordinator {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly lock: ProjectLockOwnership) {}

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      await this.lock.assertOwned();
      return operation();
    });

    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }
}
