# Security policy

## Supported versions

Security fixes land on `main` and ship in the next tagged release. Only the latest release is
supported.

## Private reporting

Report suspected vulnerabilities through GitHub private vulnerability reporting:

<https://github.com/lued/paseo-quiet-timeline/security/advisories/new>

Do not open a public issue for a vulnerability, and do not attach prompts, transcripts, tool output
or agent ids from a real session. Include the affected version or commit, the impact, a minimal
reproduction, and a mitigation if you have one.

## Trust model

`paseo-quiet-timeline` is a trusted, unsandboxed Paseo plugin: its code runs in the Paseo client and
server with the daemon user's access. It is read-only. It mirrors the open agent's timeline to group
thinking and tool calls, keeps that view in memory, and never writes agent data or stored history;
disabling it restores Paseo's own rows. It makes no network calls and has no settings, accounts or
keys.

## Scope

In scope: content that Paseo would not show becoming visible through the folded view, markup or
payload injection through tool output, and reads that cross agents or workspaces.

Out of scope: defects in Paseo itself, and the documented limit that expanded tool output is plain
monospace text rather than Paseo's code and diff viewer.
