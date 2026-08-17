import type { TaskScope } from '@agent-music/contracts';

import {
  canonicalizeExternalAbc,
  createInitialCanonicalAbc,
} from './canonical-abc.js';
import {
  compileComposition,
  type CompositionCompilation,
} from './composition-pipeline.js';
import type { ValidationReport } from './composition-types.js';
import { CompositionValidationError } from './composition-validation-error.js';
import {
  getScopedComposition,
  type ScopedComposition,
} from './scope-mapping.js';
import {
  replaceScopedMusic,
  type ScopedReplacementResult,
  type TrackReplacement,
} from './scoped-replacement.js';

export interface CanonicalizationResult {
  readonly canonicalAbc: string;
  readonly changed: boolean;
}

export class CompositionPipeline {
  public createInitialComposition(): string {
    return createInitialCanonicalAbc();
  }

  public canonicalizeExternalInput(source: string): CanonicalizationResult {
    const canonicalAbc = canonicalizeExternalAbc(source);
    return { canonicalAbc, changed: source !== canonicalAbc };
  }

  public compileCanonical(source: string): CompositionCompilation {
    return compileComposition(source);
  }

  public validateCanonical(source: string): ValidationReport {
    try {
      return this.compileCanonical(source).validationReport;
    } catch (error) {
      if (error instanceof CompositionValidationError) {
        return error.report;
      }
      throw error;
    }
  }

  public getScopedComposition(
    compilation: CompositionCompilation,
    scope: TaskScope,
  ): ScopedComposition {
    return getScopedComposition(compilation, scope);
  }

  public replaceScopedMusic(
    compilation: CompositionCompilation,
    scope: TaskScope,
    replacements: readonly TrackReplacement[],
  ): ScopedReplacementResult {
    return replaceScopedMusic(compilation, scope, replacements);
  }
}
