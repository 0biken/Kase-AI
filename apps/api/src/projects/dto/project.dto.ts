import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RepositoryInputDto } from './repository.dto';
import { TargetInputDto } from './target.dto';
import { ScopePolicyInputDto } from './scope-policy.dto';

/** Lowercase kebab; used in URLs and as the CLI's `--project` argument. */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * 14-api §3 creates the whole project graph in one call — repository, targets
 * and scopePolicy arrive nested rather than as follow-up requests.
 *
 * That shape is deliberate and worth preserving: a project without a scope
 * policy is a project nobody has attested authorization for, and leaving a
 * window where one can exist would mean the attestation rule is advisory.
 * The service applies it in a single transaction for the same reason.
 */
export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(SLUG_RE, {
    message: 'slug must be lowercase alphanumeric with single hyphens, e.g. "acme-web"',
  })
  slug?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RepositoryInputDto)
  repository?: RepositoryInputDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TargetInputDto)
  targets?: TargetInputDto[];

  /** Mandatory: carries `authorizationAttestedBy` (14-api §3). */
  @ValidateNested()
  @Type(() => ScopePolicyInputDto)
  scopePolicy!: ScopePolicyInputDto;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(SLUG_RE)
  slug?: string;

  @IsOptional()
  @IsString()
  defaultGatePolicyId?: string;
}

/** Bulk-replace variant for PUT /projects/:id/scope-policy (14-api §4). */
export class ReplaceScopePolicyDto extends ScopePolicyInputDto {}

export class CreateTargetsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => TargetInputDto)
  targets!: TargetInputDto[];
}
