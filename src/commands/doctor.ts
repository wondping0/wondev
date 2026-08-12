import { loadConfig, wondevDir, WONDEV_DIR } from '../core/config.js';
import { BUILTIN_TARGETS, resolveAlias } from '../core/registry.js';
import { SOURCE_SCHEMA_VERSION } from '../core/schema.js';
import { loadProject } from '../core/source.js';
import { loadTemplateManifest } from '../core/templates.js';
import { loadManifest } from '../core/writer.js';
import { pathExists } from '../util/fs.js';
import { error, info, style, success, warn } from '../util/log.js';
import { compareVersions } from '../util/semver.js';
import { wondevVersion } from '../util/version.js';

export interface DoctorOptions {
  /** Ask the npm registry whether a newer wondev exists. Never happens without this flag. */
  online?: boolean;
}

interface Finding {
  level: 'ok' | 'warn' | 'error';
  message: string;
}

const MIN_NODE_MAJOR = 20;

/**
 * Diagnose a project without changing anything.
 *
 * The version check is opt-in via `--online` on purpose. A background ping on every build
 * would be the only part of wondev that phones home, and would contradict both the
 * no-telemetry stance and the fast cold start.
 */
export async function runDoctor(root: string, options: DoctorOptions = {}): Promise<void> {
  const findings: Finding[] = [];

  findings.push(checkNode());
  findings.push(...(await checkProject(root)));
  if (options.online) findings.push(await checkForUpdate());

  for (const finding of findings) {
    if (finding.level === 'ok') info(`  ${style.green('ok')}    ${finding.message}`);
    else if (finding.level === 'warn') warn(finding.message);
    else error(finding.message);
  }

  const errors = findings.filter((f) => f.level === 'error').length;
  const warnings = findings.filter((f) => f.level === 'warn').length;

  info('');
  if (errors > 0) {
    error(`${errors} problem(s), ${warnings} warning(s)`);
    process.exitCode = 1;
    return;
  }
  success(warnings > 0 ? `no problems, ${warnings} warning(s)` : 'no problems found');
}

function checkNode(): Finding {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    return {
      level: 'error',
      message: `Node ${process.versions.node} is too old; wondev needs ${MIN_NODE_MAJOR} or newer.`,
    };
  }
  return { level: 'ok', message: `Node ${process.versions.node}` };
}

async function checkProject(root: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  if (!(await pathExists(wondevDir(root)))) {
    return [{ level: 'error', message: `No ${WONDEV_DIR}/ in ${root}. Run \`wondev init\`.` }];
  }

  let config;
  try {
    config = await loadConfig(root);
  } catch (err) {
    return [{ level: 'error', message: `Config: ${(err as Error).message}` }];
  }
  findings.push({ level: 'ok', message: `config loads, ${config.targets.length} target(s)` });

  if (config.schema < SOURCE_SCHEMA_VERSION) {
    findings.push({
      level: 'error',
      message: `Source schema ${config.schema} is older than ${SOURCE_SCHEMA_VERSION}. Run \`wondev migrate\`.`,
    });
  } else {
    findings.push({ level: 'ok', message: `source schema ${config.schema}` });
  }

  for (const name of config.targets) {
    const entry = BUILTIN_TARGETS[resolveAlias(name)];
    if (entry?.deprecated) {
      const replacement = entry.deprecated.replacedBy ? ` Use "${entry.deprecated.replacedBy}".` : '';
      findings.push({
        level: 'warn',
        message: `target "${name}" is deprecated since ${entry.deprecated.since}.${replacement}`,
      });
    }
  }

  const { issues } = await loadProject(root, config.name);
  // Name the problems rather than only counting them. Someone runs `doctor` because
  // something is already wrong; answering with a number and the name of a second command
  // spends a round trip to deliver one line of text.
  const sourceErrors = issues.filter((i) => i.level === 'error');
  if (sourceErrors.length === 0) {
    findings.push({ level: 'ok', message: 'sources parse cleanly' });
  } else {
    const NAMED = 3;
    for (const issue of sourceErrors.slice(0, NAMED)) {
      findings.push({ level: 'error', message: `${issue.file}: ${issue.message}` });
    }
    if (sourceErrors.length > NAMED) {
      findings.push({
        level: 'error',
        message: `and ${sourceErrors.length - NAMED} more. Run \`wondev check\` for the full report.`,
      });
    }
  }

  const manifest = await loadManifest(root);
  const tracked = Object.keys(manifest.files).length;
  if (tracked === 0) {
    findings.push({ level: 'warn', message: 'nothing has been built yet. Run `wondev build`.' });
  } else {
    const producedBy = manifest.wondevVersion;
    findings.push({
      level: 'ok',
      message: `${tracked} generated file(s) tracked${producedBy ? `, built by wondev ${producedBy}` : ''}`,
    });
    if (producedBy && producedBy !== wondevVersion()) {
      findings.push({
        level: 'warn',
        message: `output was built by wondev ${producedBy}, you are running ${wondevVersion()}. Run \`wondev build\`.`,
      });
    }
  }

  const templates = await loadTemplateManifest(root);
  if (!templates) {
    findings.push({
      level: 'warn',
      message: 'no starter-pack provenance; `wondev upgrade` cannot run for this project.',
    });
  } else if (compareVersions(templates.version, wondevVersion()) < 0) {
    findings.push({
      level: 'warn',
      message: `starter pack is from wondev ${templates.version}. Run \`wondev upgrade\` to see what changed.`,
    });
  } else {
    findings.push({ level: 'ok', message: `starter pack from wondev ${templates.version}` });
  }

  return findings;
}

async function checkForUpdate(): Promise<Finding> {
  const current = wondevVersion();
  try {
    const response = await fetch('https://registry.npmjs.org/wondev/latest', {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { level: 'warn', message: `could not reach npm (HTTP ${response.status})` };
    }
    const body = (await response.json()) as { version?: string };
    const latest = body.version;
    if (!latest) return { level: 'warn', message: 'npm returned no version' };

    if (compareVersions(latest, current) > 0) {
      return { level: 'warn', message: `wondev ${latest} is available; you have ${current}.` };
    }
    return { level: 'ok', message: `wondev ${current} is current` };
  } catch (err) {
    return { level: 'warn', message: `could not reach npm: ${(err as Error).message}` };
  }
}
