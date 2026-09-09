import { strict as assert } from 'node:assert';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, it } from 'node:test';

/**
 * resolvePath is the last line of defence on path traversal, after the DTO
 * check on the way in and the CHECK constraint in the schema. It is also the
 * only one of the three that is still standing if a filename is ever written
 * to the database by something other than the panel.
 *
 * config.ts resolves every environment variable at import time, so the root
 * has to be set before vault.service is loaded. A top-level `import` is
 * hoisted above the assignment and would read the default instead, which is
 * why the service is pulled in with require() below and not at the top.
 */
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'vault-test-')));
process.env.VAULT_FILES_DIR = ROOT;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { VaultService } = require('./vault.service') as typeof import('./vault.service');

/**
 * resolvePath touches nothing but the filesystem path, so the service is
 * built without a database rather than with a fake one. A stub would have to
 * be kept in step with a dependency this test does not exercise.
 */
const vault = new VaultService(undefined as never);

const inside = (name: string): string => vault.resolvePath(name);

describe('VaultService.resolvePath', () => {
  it('resolves an ordinary filename inside the vault directory', () => {
    assert.equal(inside('cv.pdf'), join(ROOT, 'cv.pdf'));
  });

  it('discards a directory part rather than following it', () => {
    // basename() throws the traversal away, so these all land on the file
    // name itself: the request never escapes and never 404s confusingly.
    assert.equal(inside('../../../etc/passwd'), join(ROOT, 'passwd'));
    assert.equal(inside('subdir/../../cv.pdf'), join(ROOT, 'cv.pdf'));
    assert.equal(inside('/etc/shadow'), join(ROOT, 'shadow'));
  });

  it('discards a Windows-style directory part too', () => {
    // Only meaningful where the separator is a backslash; elsewhere the whole
    // string is a legal (if odd) filename and stays inside the root either
    // way, which is the property under test.
    const resolved = inside('..\\..\\windows\\system32\\config\\sam');
    assert.ok(
      resolved === join(ROOT, 'sam') || resolved.startsWith(ROOT + sep),
      'stays inside the vault directory',
    );
  });

  it('refuses the names that basename cannot reduce to a file', () => {
    for (const name of ['', '.', '..', '/', '../', './']) {
      assert.throws(() => inside(name), /Document not found/, `refused ${JSON.stringify(name)}`);
    }
  });

  it('keeps every result inside the root', () => {
    const attempts = [
      'cv.pdf',
      '../secret.pdf',
      '....//....//secret.pdf',
      'a/b/c/d/e.pdf',
      '%2e%2e%2fsecret.pdf',
      'nul.pdf',
      '.hidden.pdf',
    ];

    for (const name of attempts) {
      const resolved = inside(name);
      assert.ok(
        resolved.startsWith(ROOT + sep),
        `${name} resolved to ${resolved}, which is outside ${ROOT}`,
      );
    }
  });

  /**
   * The trailing separator on the prefix is the whole point of the
   * containment check. Without it a sibling directory whose name merely
   * starts with the root's name passes a naive startsWith.
   */
  it('does not accept a sibling directory with a prefixed name', () => {
    const resolved = inside('cv.pdf');
    assert.ok(!(ROOT + '-secret').startsWith(ROOT + sep));
    assert.ok(resolved.startsWith(ROOT + sep));
  });
});
