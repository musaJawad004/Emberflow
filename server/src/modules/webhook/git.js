import { runCommand } from '../../core/docker.js';

// Clones `url` into `dest`, checks out `checkout` (branch/tag/sha) when given,
// and returns the resolved HEAD commit sha. Throws on git failures.
export async function cloneRepo({ url, checkout, dest }) {
  await git(['clone', url, dest]);
  if (checkout) {
    // Webhooks send refs like "refs/heads/main"; git wants the short name.
    const target = checkout.replace(/^refs\/(heads|tags)\//, '');
    await git(['-C', dest, 'checkout', target]);
  }
  const { stdout } = await git(['-C', dest, 'rev-parse', 'HEAD']);
  return stdout.trim();
}

async function git(args) {
  const result = await runCommand('git', args);
  if (result.code !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim().slice(0, 300)}`);
  }
  return result;
}
