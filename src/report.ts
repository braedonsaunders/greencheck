import * as core from '@actions/core';
import * as github from '@actions/github';
import * as https from 'https';
import { GreenCheckConfig, RunState } from './types';

type Octokit = ReturnType<typeof github.getOctokit>;

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function buildPRCommentBody(state: RunState): string {
  const statusLabel = state.result === 'success'
    ? ':white_check_mark: CI is now green'
    : state.result === 'partial'
      ? ':warning: Partially fixed - some failures remain'
      : ':x: Could not fix all failures';

  const duration = formatDuration(Date.now() - new Date(state.startedAt).getTime());
  let body = `## greencheck report\n\n${statusLabel}\n\n`;
  body += '| Metric | Value |\n|--------|-------|\n';
  body += `| Passes | ${state.passes.length} |\n`;
  body += `| Duration | ${duration} |\n`;
  body += `| Estimated Cost | ${formatCost(state.totalCostCents)} |\n`;
  body += `| Commits | ${state.commits.length} |\n\n`;

  if (state.passes.length > 0) {
    body += '### Fix Summary\n\n';
    for (const pass of state.passes) {
      const scopeLabel = pass.cluster.files.length > 0
        ? `in \`${pass.cluster.files.join('`, `')}\``
        : 'with repository-wide investigation';
      body += `**Pass ${pass.pass}** - ${pass.result} - ${pass.cluster.type} ${scopeLabel}\n`;
      body += `- ${pass.cluster.failures.length} parsed failure hint(s) addressed\n`;
      if (pass.commitSha) {
        body += `- Commit: \`${pass.commitSha.substring(0, 7)}\`\n`;
      }
      if (pass.filesChanged.length > 0) {
        body += `- Files changed: ${pass.filesChanged.map((file) => `\`${file}\``).join(', ')}\n`;
      }
      if (pass.newFailures.length > 0) {
        body += `- New failures detected: ${pass.newFailures.length}\n`;
      }
      body += '\n';
    }
  }

  if (state.latestFailures.length > 0) {
    body += '### Remaining Failures\n\n';
    body += `<details><summary>${state.latestFailures.length} failure(s) remaining</summary>\n\n`;
    for (const failure of state.latestFailures.slice(0, 20)) {
      const location = failure.line ? `${failure.file}:${failure.line}` : failure.file;
      body += `- \`${location}\` - ${failure.message}\n`;
    }
    if (state.latestFailures.length > 20) {
      body += `\n... and ${state.latestFailures.length - 20} more\n`;
    }
    body += '\n</details>\n\n';
  }

  body += '---\n';
  body += '*Automated by [greencheck](https://github.com/braedonsaunders/greencheck).*';
  return body;
}

function buildJobSummary(state: RunState): string {
  const status = state.result === 'success'
    ? 'Fixed'
    : state.result === 'partial'
      ? 'Partial'
      : 'Failed';

  let summary = `## greencheck: ${status}\n\n`;
  summary += `- **Branch:** \`${state.branch}\`\n`;
  summary += `- **Workflow:** ${state.workflowName || 'unknown'}\n`;
  summary += `- **Passes:** ${state.passes.length}\n`;
  summary += `- **Cost:** ${formatCost(state.totalCostCents)}\n`;
  summary += `- **Commits:** ${state.commits.map((sha) => `\`${sha.substring(0, 7)}\``).join(', ') || 'none'}\n`;
  summary += `- **Remaining failures:** ${state.latestFailures.length}\n\n`;

  for (const pass of state.passes) {
    summary += `### Pass ${pass.pass}: ${pass.result}\n`;
    summary += `- Type: ${pass.cluster.type}\n`;
    summary += `- Files: ${pass.cluster.files.join(', ') || 'repository-wide'}\n`;
    summary += `- Parsed failure hints: ${pass.cluster.failures.length}\n\n`;
  }

  return summary;
}

export async function postPRComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  state: RunState,
): Promise<void> {
  const body = buildPRCommentBody(state);
  const marker = '<!-- greencheck-report -->';

  try {
    // Paginate to find our marker comment — PRs with 100+ comments would miss it otherwise
    let existing: { id: number; body?: string | null } | undefined;
    let page = 1;
    while (!existing) {
      const { data: comments } = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
        per_page: 100,
        page,
      });

      if (comments.length === 0) break;
      existing = comments.find((comment: any) => comment.body?.includes(marker));
      if (comments.length < 100) break;
      page++;
    }
    if (existing) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body: `${marker}\n${body}`,
      });
      core.info(`Updated existing PR comment #${existing.id}`);
      return;
    }

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: `${marker}\n${body}`,
    });
    core.info(`Posted new PR comment on #${prNumber}`);
  } catch (error) {
    core.warning(`Failed to post PR comment: ${error}`);
  }
}

export async function writeJobSummary(state: RunState): Promise<void> {
  const summary = buildJobSummary(state);
  await core.summary.addRaw(summary).write();
  core.info('Wrote job summary');
}

export async function sendSlackNotification(
  webhookUrl: string,
  state: RunState,
): Promise<void> {
  const status = state.result === 'success' ? 'Fixed' : 'Failed';
  const payload = JSON.stringify({
    text: `greencheck: CI ${status} on \`${state.branch}\``,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*greencheck: CI ${status}*`,
            `Branch: \`${state.branch}\``,
            `Passes: ${state.passes.length}`,
            `Cost: ${formatCost(state.totalCostCents)}`,
            `Commits: ${state.commits.length}`,
          ].join('\n'),
        },
      },
    ],
  });

  await new Promise<void>((resolve) => {
    const url = new URL(webhookUrl);
    const request = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          core.info('Sent Slack notification');
        } else {
          core.warning(`Slack notification failed with status ${response.statusCode}`);
        }
        resolve();
      },
    );

    request.on('error', (error) => {
      core.warning(`Slack notification error: ${error}`);
      resolve();
    });

    request.write(payload);
    request.end();
  });
}

export async function report(
  octokit: Octokit,
  owner: string,
  repo: string,
  state: RunState,
  config: GreenCheckConfig,
): Promise<void> {
  if (config.report.prComment && state.prNumber) {
    await postPRComment(octokit, owner, repo, state.prNumber, state);
  }

  if (config.report.jobSummary) {
    await writeJobSummary(state);
  }

  if (config.report.slackWebhook) {
    await sendSlackNotification(config.report.slackWebhook, state);
  }

  core.setOutput('fixed', state.result === 'success');
  core.setOutput('passes', state.passes.length);
  core.setOutput('failures-found', state.passes.reduce((sum, pass) => sum + pass.cluster.failures.length, 0));
  core.setOutput('failures-fixed', state.passes.filter((pass) => pass.result === 'fixed').reduce((sum, pass) => sum + pass.cluster.failures.length, 0));
  core.setOutput('commits', state.commits.join(','));
  core.setOutput('cost', formatCost(state.totalCostCents));
}

export { buildJobSummary, buildPRCommentBody };
