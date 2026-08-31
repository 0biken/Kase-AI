import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const SECRET_KINDS = [
  'repository_token',
  'target_header',
  'target_cookie',
  'oauth_client',
  'provider_api_key',
] as const;

export class CreateSecretDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(SECRET_KINDS)
  kind!: (typeof SECRET_KINDS)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(16_384)
  value!: string;
}

export class RotateSecretDto {
  @IsString()
  @MinLength(1)
  @MaxLength(16_384)
  value!: string;
}
