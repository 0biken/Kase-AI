/** Per-job redactor. Registered values live only for the lifetime of one job. */
export class SensitiveValueRedactor {
  private readonly values = new Set<string>();

  register(value: string): void {
    if (value.length > 0) this.values.add(value);
  }

  redact(value: string): { value: string; changed: boolean } {
    let output = value;
    for (const secret of this.values) output = output.split(secret).join('[redacted]');
    return { value: output, changed: output !== value };
  }

  clear(): void {
    this.values.clear();
  }
}
