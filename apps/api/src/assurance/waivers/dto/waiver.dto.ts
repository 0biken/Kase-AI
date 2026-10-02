import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * A waiver grant. `expiresAt` is required at the type level — there is no
 * permanent waiver (12-policy-gate §5); permanent acceptance is the
 * `accepted_risk` finding status, a different record. `approvedBy` is the
 * attributed approver, checked against the requester when the active policy
 * requires a separate approver.
 */
export class WaiverInputDto {
  @IsString()
  @MinLength(1)
  fingerprint!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;

  @IsString()
  @MinLength(1)
  approvedBy!: string;

  @IsDateString()
  expiresAt!: string;

  @IsOptional()
  @IsString()
  affectedRelease?: string;
}

export class SuppressionInputDto {
  @IsString()
  @MinLength(1)
  fingerprint!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}
