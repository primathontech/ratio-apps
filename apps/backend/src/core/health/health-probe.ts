export interface HealthProbe {
  readonly name: string;
  check(): Promise<void>;
}
