import { alwaysOnTokens, docTokens } from '../core/render/index-doc.js';
import { estimateTokens, formatTokens } from '../util/tokens.js';
import { info, style } from '../util/log.js';
import { loadContext } from './context.js';

/**
 * What this project defines, and what each piece costs.
 *
 * `doctor` diagnoses problems and `check` verifies output; neither answers the plainest
 * question a person has when opening an unfamiliar repository -- what is in here. The cost
 * column is included because the whole design turns on it: which documents are always-on,
 * and which procedures are carried rather than referenced.
 */
export async function runList(root: string): Promise<void> {
  const ctx = await loadContext(root);
  const { project } = ctx;

  const line = (name: string, cost: string, note: string): void => {
    info(`  ${style.cyan(name.padEnd(34))} ${style.dim(cost.padStart(7))}  ${style.dim(note)}`);
  };

  if (project.memory.length > 0) {
    const always = project.memory.filter((d) => d.always);
    const onDemand = project.memory.filter((d) => !d.always);

    if (always.length > 0) {
      info(style.bold(`Memory — always loaded (≈${formatTokens(alwaysOnTokens(project))} every turn)`));
      for (const d of always) {
        line(d.slug, `≈${formatTokens(docTokens(d))}`, d.verified ? `✓ ${d.verified}` : 'unverified');
      }
      info('');
    }
    if (onDemand.length > 0) {
      info(style.bold('Memory — on demand'));
      for (const d of onDemand) {
        // Freshness belongs here as much as above. "Is this still true?" is not a question
        // only always-on documents raise -- an on-demand one is read precisely when someone
        // is about to rely on it.
        const note = [d.verified ? `✓ ${d.verified}` : 'unverified', d.description]
          .filter(Boolean)
          .join(' · ');
        line(d.slug, `≈${formatTokens(docTokens(d))}`, note);
      }
      info('');
    }
  }

  if (project.skills.length > 0) {
    info(style.bold('Skills'));
    for (const s of project.skills) {
      const marks = [
        s.inline ? 'inlined' : 'referenced',
        s.attachments.length > 0 ? `+${s.attachments.length} ref` : '',
      ].filter(Boolean);
      line(s.name, `≈${formatTokens(estimateTokens(s.body))}`, `${marks.join(', ')} — ${s.description}`);
    }
    info('');
  }

  if (project.agents.length > 0) {
    info(style.bold('Subagents'));
    for (const a of project.agents) {
      line(a.name, `≈${formatTokens(estimateTokens(a.body))}`, a.description);
    }
    info('');
  }

  if (project.commands.length > 0) {
    info(style.bold('Commands'));
    for (const c of project.commands) {
      line(`/${c.name}`, `≈${formatTokens(estimateTokens(c.body))}`, c.description);
    }
    info('');
  }

  const empty =
    project.memory.length === 0 &&
    project.skills.length === 0 &&
    project.commands.length === 0 &&
    project.agents.length === 0;
  if (empty) {
    info('This project defines nothing yet.');
    info(style.dim('  Run `wondev add memory architecture` to start.'));
    return;
  }

  info(style.dim(`targets: ${ctx.targets.map((t) => t.name).join(', ')}`));
}
