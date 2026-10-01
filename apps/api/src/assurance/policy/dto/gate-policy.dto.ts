import { IsNotEmptyObject, IsObject } from 'class-validator';

/**
 * The gate-policy body is the policy DSL itself, carried under `rules`. It is
 * validated in depth by the zod schema in the service (not here): class-validator
 * whitelisting cannot express the DSL's shape, and duplicating it would let the
 * two definitions drift. The DTO only guarantees `rules` is a non-empty object
 * so the global ValidationPipe does not strip it.
 */
export class GatePolicyInputDto {
  @IsObject()
  @IsNotEmptyObject()
  rules!: Record<string, unknown>;
}
