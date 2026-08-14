export class WriteSafetyPolicy {
  private readonly readOnlyByContext = new Map<string, boolean>();

  setReadOnly(contextId: string, readOnly: boolean): void {
    this.readOnlyByContext.set(contextId, readOnly);
  }

  isReadOnly(contextId: string): boolean {
    return this.readOnlyByContext.get(contextId) !== false;
  }

  assertWriteAllowed(contextId: string, operation: string): void {
    if (this.isReadOnly(contextId)) {
      throw new Error(`${operation} is blocked while this context is read-only`);
    }
  }
}
