import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { validateAllowedHosts } from '../../common/host-pattern';

/**
 * Enforces 17-security §3 host rules at the DTO boundary, so a malformed
 * allowlist is rejected before it reaches the database — "Bare TLDs and `*`
 * rejected at policy creation".
 */
@ValidatorConstraint({ name: 'allowedHosts', async: false })
export class AllowedHostsConstraint implements ValidatorConstraintInterface {
  private errors: string[] = [];

  validate(value: unknown): boolean {
    const result = validateAllowedHosts(value as string[]);
    this.errors = result.errors;
    return result.valid;
  }

  defaultMessage(_args: ValidationArguments): string {
    return this.errors.join('; ');
  }
}

export class ScopePolicyInputDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Validate(AllowedHostsConstraint)
  allowedHosts!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deniedPaths?: string[];

  @IsInt()
  @Min(1)
  @Max(1000)
  maxRequestsPerSecond!: number;

  @IsInt()
  @Min(1)
  @Max(10_000_000)
  maxRequestsPerAudit!: number;

  /**
   * 17-security §6: defaults to false. Enabling it requires separate
   * attestation, checked in the service rather than here — the DTO cannot see
   * whether the attestation is fresh.
   */
  @IsOptional()
  @IsBoolean()
  destructiveAllowed?: boolean;

  /**
   * 14-api §3: "mandatory. A project cannot be created without an attestation
   * that the requester is authorized to test the target."
   */
  @IsEmail()
  authorizationAttestedBy!: string;
}
