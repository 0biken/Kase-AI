import { ID_PREFIX, IdKind, assertId, isId, newId } from './ids';

describe('prefixed ULIDs — 14-api §1', () => {
  it('generates a prefixed ULID', () => {
    const id = newId('project');
    expect(id).toMatch(/^prj_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  });

  it('uses the documented prefixes', () => {
    // These four appear literally in the docs; the rest are ours to choose.
    expect(newId('project')).toStartWith('prj_');
    expect(newId('audit')).toStartWith('aud_');
    expect(newId('finding')).toStartWith('fnd_');
    expect(newId('target')).toStartWith('tgt_');
  });

  it('assigns a distinct prefix to every kind', () => {
    // A duplicate prefix would make isId() ambiguous and let a mis-scoped ID
    // pass validation for the wrong resource.
    const prefixes = Object.values(ID_PREFIX);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId('finding')));
    expect(ids.size).toBe(2000);
  });

  it('sorts lexicographically by creation order', async () => {
    // This is why ULID over UUID: cursor pagination in §1 relies on it.
    const first = newId('audit');
    await new Promise((r) => setTimeout(r, 3));
    const second = newId('audit');
    expect(first < second).toBe(true);
  });

  describe('isId', () => {
    it('accepts a matching id', () => {
      expect(isId('project', newId('project'))).toBe(true);
    });

    it('rejects the right shape under the wrong prefix', () => {
      // The case that matters: passing an audit id where a project id belongs
      // must fail loudly rather than querying for something that cannot exist.
      expect(isId('project', newId('audit'))).toBe(false);
    });

    it('rejects a bare ULID with no prefix', () => {
      expect(isId('project', '01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(false);
    });

    it('rejects a prefix with a malformed body', () => {
      expect(isId('project', 'prj_not-a-ulid')).toBe(false);
      expect(isId('project', 'prj_')).toBe(false);
      // Crockford base32 excludes I, L, O and U.
      expect(isId('project', 'prj_01ARZ3NDEKTSV4RRFFQ69G5FAU')).toBe(false);
    });

    it('rejects a uuid, which is what the schema used to emit', () => {
      expect(isId('project', '550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });

    it('rejects non-strings', () => {
      for (const v of [null, undefined, 42, {}, []]) {
        expect(isId('project', v)).toBe(false);
      }
    });

    it('is not fooled by a prefix appearing later in the string', () => {
      expect(isId('project', `x_prj_${'0'.repeat(26)}`)).toBe(false);
    });
  });

  describe('assertId', () => {
    it('returns the id when valid', () => {
      const id = newId('scopePolicy');
      expect(assertId('scopePolicy', id)).toBe(id);
    });

    it('throws on a mismatch, naming the expected prefix', () => {
      expect(() => assertId('project', newId('audit'))).toThrow(/prj_/);
    });
  });

  it('round-trips every kind through isId', () => {
    for (const kind of Object.keys(ID_PREFIX) as IdKind[]) {
      expect(isId(kind, newId(kind))).toBe(true);
    }
  });
});

expect.extend({
  toStartWith(received: string, prefix: string) {
    const pass = received.startsWith(prefix);
    return {
      pass,
      message: () => `expected "${received}" ${pass ? 'not ' : ''}to start with "${prefix}"`,
    };
  },
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toStartWith(prefix: string): R;
    }
  }
}
