import { Command } from 'commander';
import { ErrorCode, formatCliError } from '../cli-errors.js';
import {
  doctorCliTool,
  findCliToolEntry,
  findToolGuide,
  getCliToolStatus,
  installCliTool,
  listCliToolEntries,
  removeCliTool,
} from './registry.js';

function requireEntry(name: string) {
  const entry = findCliToolEntry(name);
  if (!entry) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'CLI_TOOL_NOT_FOUND',
        message: `Tool "${name}" not found`,
        details: `Available tools: ${listCliToolEntries().map((item) => item.name).join(', ')}`,
        suggestion: 'Run pibo tools list to see curated tools.',
      }),
    );
  }
  return entry;
}

function printList(installedOnly: boolean): void {
  const rows = listCliToolEntries()
    .map((entry) => getCliToolStatus(entry))
    .filter((status) => !installedOnly || status.installed)
    .map((status) => ({
      name: status.entry.name,
      status: status.installed ? 'installed' : 'available',
      executable: status.installed ? status.executablePath : '',
      description: status.entry.description,
    }));

  if (rows.length === 0) {
    console.log(installedOnly ? 'No cli tools are installed.' : 'No cli tools are currently bundled.');
    return;
  }

  console.table(rows);
}

function printShow(name: string): void {
  const entry = requireEntry(name);
  const status = getCliToolStatus(entry);
  console.log(`${entry.name}`);
  console.log(`  ${entry.description}`);
  console.log(`  status: ${status.installed ? 'installed' : 'available'}`);
  console.log(`  runtime: ${status.rootDir}`);
  console.log(`  home: ${status.homeDir}`);
  console.log(`  executable: ${status.executablePath}`);
  console.log('');
  console.log('Guides:');
  for (const guide of entry.guides) {
    console.log(`  ${guide.name}\t${guide.description}`);
  }
  if (entry.notes.length > 0) {
    console.log('');
    console.log('Notes:');
    for (const note of entry.notes) console.log(`  - ${note}`);
  }
}

function printGuides(name: string): void {
  const entry = requireEntry(name);
  for (const guide of entry.guides) {
    console.log(`${guide.name}\t${guide.description}`);
  }
}

function printGuide(name: string, guideName?: string): void {
  const entry = requireEntry(name);
  const selectedGuideName = guideName ?? entry.guides[0]?.name;
  if (!selectedGuideName) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'CLI_TOOL_GUIDE_NOT_FOUND',
        message: `Tool "${name}" has no guides`,
      }),
    );
  }

  const guide = findToolGuide(entry, selectedGuideName);
  if (!guide) {
    throw new Error(
      formatCliError({
        code: ErrorCode.CLIENT_ERROR,
        type: 'CLI_TOOL_GUIDE_NOT_FOUND',
        message: `Guide "${selectedGuideName}" not found for tool "${name}"`,
        details: `Available guides: ${entry.guides.map((item) => item.name).join(', ')}`,
      }),
    );
  }
  console.log(guide.content);
}

function printPath(name: string): void {
  const entry = requireEntry(name);
  console.log(getCliToolStatus(entry).executablePath);
}

function printEnv(name: string): void {
  const entry = requireEntry(name);
  const status = getCliToolStatus(entry);

  if (process.platform === 'win32') {
    console.log(`$env:PATH = "${status.executablePath.replace(/\\[^\\]+$/, '')};$env:PATH"`);
    if (entry.runtime.homeEnvVar) console.log(`$env:${entry.runtime.homeEnvVar} = "${status.homeDir}"`);
    return;
  }

  const binDir = status.executablePath.replace(/\/[^/]+$/, '');
  console.log(`export PATH="${binDir}:$PATH"`);
  if (entry.runtime.homeEnvVar) console.log(`export ${entry.runtime.homeEnvVar}="${status.homeDir}"`);
}

export async function runToolsCli(argv = process.argv): Promise<void> {
  const program = new Command();
  program
    .name('pibo tools')
    .description('Install and inspect curated external CLI tools')
    .showHelpAfterError();

  program
    .command('list')
    .description('List curated CLI tools')
    .action(() => printList(false));

  program
    .command('installed')
    .description('List installed CLI tools')
    .action(() => printList(true));

  program
    .command('show')
    .argument('<name>')
    .description('Show one CLI tool preset')
    .action(printShow);

  program
    .command('install')
    .argument('<name>')
    .option('--no-setup', 'Only print install target without installing runtime')
    .description('Install a CLI tool')
    .action(async (name: string, options: { setup?: boolean }) => {
      await installCliTool(requireEntry(name), options.setup !== false);
    });

  program
    .command('remove')
    .argument('<name>')
    .description('Remove an installed CLI tool runtime')
    .action(async (name: string) => {
      await removeCliTool(requireEntry(name));
    });

  program
    .command('doctor')
    .argument('<name>')
    .description('Check tool prerequisites and runtime state')
    .action(async (name: string) => {
      await doctorCliTool(requireEntry(name));
    });

  program
    .command('guides')
    .argument('<name>')
    .description('List guides for a CLI tool')
    .action(printGuides);

  program
    .command('guide')
    .argument('<name>')
    .argument('[guide]')
    .description('Print a CLI tool guide')
    .action(printGuide);

  program
    .command('path')
    .argument('<name>')
    .description('Print the installed tool executable path')
    .action(printPath);

  program
    .command('env')
    .argument('<name>')
    .description('Print shell exports for using the tool directly')
    .action(printEnv);

  if (argv.length <= 2) argv = [...argv, 'list'];

  try {
    await program.parseAsync(argv);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = ErrorCode.CLIENT_ERROR;
  }
}
