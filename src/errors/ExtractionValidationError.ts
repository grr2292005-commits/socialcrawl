export class ExtractionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionValidationError';
  }
}
