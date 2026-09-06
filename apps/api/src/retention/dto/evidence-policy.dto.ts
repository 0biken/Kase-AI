import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 365;

export class OrganizationEvidencePolicyDto {
  @IsInt() @Min(MIN_RETENTION_DAYS) @Max(MAX_RETENTION_DAYS)
  replayableEvidenceDays!: number;

  @IsInt() @Min(MIN_RETENTION_DAYS) @Max(MAX_RETENTION_DAYS)
  nonReplayableEvidenceDays!: number;

  @IsInt() @Min(MIN_RETENTION_DAYS) @Max(MAX_RETENTION_DAYS)
  rawToolOutputDays!: number;

  @IsInt() @Min(MIN_RETENTION_DAYS) @Max(MAX_RETENTION_DAYS)
  agentTranscriptDays!: number;
}
export class ProjectEvidencePolicyDto {
  @IsOptional() @IsInt() @Min(MIN_RETENTION_DAYS) @Max(MAX_RETENTION_DAYS)
  replayableEvidenceDays!: number | null;

  @IsOptional() @IsInt() @Min(MIN_RETENTION_DAYS) @Max(MAX_RETENTION_DAYS)
  nonReplayableEvidenceDays!: number | null;

  @IsOptional() @IsInt() @Min(MIN_RETENTION_DAYS) @Max(MAX_RETENTION_DAYS)
  rawToolOutputDays!: number | null;

  @IsOptional() @IsInt() @Min(MIN_RETENTION_DAYS) @Max(MAX_RETENTION_DAYS)
  agentTranscriptDays!: number | null;
}
