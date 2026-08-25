import { IsIn, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

/**
 * `Repository.provider` is documented as 'github' only (03-data-model §2).
 * Kept as a list rather than a bare string so adding GitLab later is a
 * one-line change with a compile-time reminder at every switch.
 */
export const REPOSITORY_PROVIDERS = ['github'] as const;

export class RepositoryInputDto {
  @IsIn(REPOSITORY_PROVIDERS)
  provider!: (typeof REPOSITORY_PROVIDERS)[number];

  @IsUrl({ require_protocol: true, protocols: ['https'] })
  url!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  defaultBranch!: string;

  /** Reference to a stored credential; never the secret itself (17 §7). */
  @IsOptional()
  @IsString()
  credentialId?: string;
}

export class UpdateRepositoryDto {
  @IsOptional()
  @IsIn(REPOSITORY_PROVIDERS)
  provider?: (typeof REPOSITORY_PROVIDERS)[number];

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  url?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  defaultBranch?: string;

  @IsOptional()
  @IsString()
  credentialId?: string;
}
