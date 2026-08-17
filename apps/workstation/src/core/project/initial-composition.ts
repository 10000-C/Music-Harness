import { createInitialCanonicalAbc } from '../composition/canonical-abc.js';

export interface InitialCompositionProvider {
  createInitialComposition(): string;
}

export const INITIAL_COMPOSITION_FIXTURE = createInitialCanonicalAbc();

export const createInitialComposition = (): string =>
  createInitialCanonicalAbc();
