import { ROLES_KEY } from '../auth/roles.decorator';
import { SecretsController } from './secrets.controller';

describe('SecretsController authorization', () => {
  it('makes every secret route admin-only at the controller boundary', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SecretsController)).toEqual(['admin']);
  });
});
