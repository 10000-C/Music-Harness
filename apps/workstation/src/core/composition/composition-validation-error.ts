import type {
  CompositionValidationIssue,
  CompositionValidationIssueCode,
  ValidationReport,
} from './composition-types.js';

export class CompositionValidationError extends Error {
  public readonly report: ValidationReport;

  public constructor(issue: CompositionValidationIssue) {
    super(issue.message);
    this.name = 'CompositionValidationError';
    this.report = { valid: false, issues: [issue] };
  }
}

export const failCompositionValidation = (
  code: CompositionValidationIssueCode,
  message: string,
): never => {
  throw new CompositionValidationError({ code, message });
};
