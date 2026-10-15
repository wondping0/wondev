import fs from 'node:fs/promises';
import path from 'node:path';
import { applyMemoryProposal, proposeMemory, readProposal, recordSession, rejectMemoryProposal, renderProposal, type SessionInput } from '../core/sessions.js';
import { createRootGuard } from '../util/paths.js';
import { WondevError } from '../util/errors.js';
import { info, success } from '../util/log.js';
import { runBuild } from './build.js';

export async function runSession(root: string, args: string[], options: { input?: string | undefined; reviewHash?: string | undefined; noBuild?: boolean } = {}): Promise<void> {
  const action = args[0];
  if (action === 'record' || action === 'propose') {
    if (!options.input) throw new WondevError('Use --input with a session JSON file or proposed memory Markdown file.');
    await createRootGuard(root)(options.input);
    const raw = await fs.readFile(path.join(root, options.input), 'utf8');
    if (action === 'record') {
      let input: SessionInput;
      try { input = JSON.parse(raw) as SessionInput; } catch { throw new WondevError('Session input must be valid JSON.'); }
      info(await recordSession(root, input));
    } else {
      if (!args[1] || !args[2]) throw new WondevError('Usage: wondev session propose <session-id> <memory-id> --input updated.md');
      const proposal = await proposeMemory(root, args[1], args[2], raw);
      info(renderProposal(proposal));
    }
    return;
  }
  if (!args[1]) throw new WondevError('Usage: wondev session record|propose|review|apply|reject');
  if (action === 'review') info(renderProposal(await readProposal(root, args[1])));
  else if (action === 'apply') {
    await applyMemoryProposal(root, args[1], options.reviewHash ?? '');
    success(`Applied proposal ${args[1]}. Verify the revised memory against its evidence.`);
    if (!options.noBuild) await runBuild(root);
  } else if (action === 'reject') {
    await rejectMemoryProposal(root, args[1]);
    success(`Rejected proposal ${args[1]}.`);
  } else throw new WondevError(`Unknown session action: ${action}`);
}
