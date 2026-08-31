import { copyFile, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

const safeName = /^[a-z0-9][a-z0-9-]{0,79}$/;
const [template = 'm1-closeout', scope = template] = process.argv.slice(2);
if (!safeName.test(template) || !safeName.test(scope)) {
  throw new Error('Template and scope must use lowercase letters, numbers, and hyphens only');
}

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'quality-gates', `${template}.md`);
const destinationDir = resolve(root, '.unlazy', scope);
const destination = resolve(destinationDir, 'GATES.md');

await access(source, constants.R_OK).catch(() => {
  throw new Error(`Unknown gate template: ${template}`);
});
await access(destination, constants.F_OK).then(
  () => { throw new Error(`Ledger already exists: .unlazy/${scope}/GATES.md`); },
  () => undefined,
);
await mkdir(destinationDir, { recursive: true });
await copyFile(source, destination, constants.COPYFILE_EXCL);
console.log(`Created .unlazy/${scope}/GATES.md; inspect it before approving any CHECK command.`);
