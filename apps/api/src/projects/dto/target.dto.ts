import { IsIn, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

/** 03-data-model §2 enumerates both of these as plain strings with a comment. */
export const TARGET_ENVIRONMENTS = ['production', 'staging', 'beta', 'local'] as const;
export const TARGET_AUTH_MODES = ['none', 'header', 'cookie', 'oauth', 'form'] as const;

export type TargetEnvironment = (typeof TARGET_ENVIRONMENTS)[number];

export class TargetInputDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  baseUrl!: string;

  @IsIn(TARGET_ENVIRONMENTS)
  environment!: TargetEnvironment;

  @IsOptional()
  @IsIn(TARGET_AUTH_MODES)
  authMode?: (typeof TARGET_AUTH_MODES)[number];

  @IsOptional()
  @IsString()
  authCredentialId?: string;

  /** ADR-003 build provenance endpoint; correlation is unverified without it. */
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  buildInfoUrl?: string;
}

export class UpdateTargetDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }) baseUrl?: string;
  @IsOptional() @IsIn(TARGET_ENVIRONMENTS) environment?: TargetEnvironment;
  @IsOptional() @IsIn(TARGET_AUTH_MODES) authMode?: (typeof TARGET_AUTH_MODES)[number];
  @IsOptional() @IsString() authCredentialId?: string;
  @IsOptional() @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }) buildInfoUrl?: string;
}
