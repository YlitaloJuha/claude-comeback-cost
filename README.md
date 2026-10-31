<h1 align="center">claude-cold-cache</h1>

<p align="center"><b>See what your next message will cost before you send it, when the prompt cache has gone cold.</b></p>

<p align="center">
  <img alt="type: Claude Code mod" src="https://img.shields.io/badge/type-Claude%20Code%20mod-6f42c1?style=flat-square">
  <img alt="tested on: Claude Code 2.1.292" src="https://img.shields.io/badge/tested%20on-Claude%20Code%202.1.292-D97757?style=flat-square">
  <img alt="tests: 10 passing" src="https://img.shields.io/badge/tests-10%20passing-2ea44f?style=flat-square">
  <img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-555?style=flat-square">
</p>

<p align="center"><img src="docs/usage.svg" alt="Mock-up of the cold cache row on its own, using the text the mod writes" width="860"></p>

<p align="center"><sub>Mock-up with the text the mod writes. The row itself was tested live using a copy with a 20-second cache lifetime.</sub></p>

Come back after a long break and one short message can rewrite your whole conversation at the expensive rate. This shows the price above the prompt first. It never blocks you, never pings, and spends nothing.

## Install

In a terminal, inside Claude Code:

```
/plugin install cold-cache --marketplace YlitaloJuha/claude-cold-cache
```

Or from a shell:

```bash
claude plugin install cold-cache --marketplace YlitaloJuha/claude-cold-cache
```

In the desktop app, click + next to the prompt box, then Plugins, Add marketplace with `YlitaloJuha/claude-cold-cache`, then Add plugin.

> [!NOTE]
> This repository is private for now. Installing needs read access and a GitHub credential on your machine, such as `gh auth login` then `gh auth setup-git`.

## What it does

- **Warns before you send:** The row appears at the moment the cache goes cold, not after you have paid.
- **A real price:** Context size times the cache-write rate for your model.
- **Knows when it does not matter:** Quiet under 50k tokens, after `/clear`, and after a compaction.
- **Handles resumes:** A resumed session uses Claude Code's own estimate when it has one, and says "may be cold" when it does not.

## What it costs

None. It makes no model calls and never keeps the cache warm.

## What it can reach

No network, no shell commands and no file access through the mod API. It reads usage and timing from Claude Code. Run `claude plugin validate .` in this repository to list every call it makes.

## Limits

- It assumes a one-hour cache. Mods cannot see the lifetime, so sessions on the five-minute cache get the warning late, with too high a price.
- Prices are a hand-kept table from Anthropic's model list dated 2026-10-06. Partner clouds price differently, and on a subscription the figure is a list-price estimate.

## Develop

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## Credits

- The idea and the timing rules come from [cache-tax](https://github.com/karanb192/cache-tax) by Karan Bansal (MIT), see `LICENSE-cache-tax`. This is the warn-only version. If you want the cache kept warm as well, use cache-tax.

## Try other mods together

This mod works on its own, and it also works side by side with my other Claude Code mods. See [the full list on my profile](https://github.com/YlitaloJuha/YlitaloJuha#claude-code-mods).

## License and warranty

[MIT](LICENSE). `LICENSE-cache-tax` covers the parts adapted from cache-tax.

Provided **as is, with no warranty of any kind**. You use it at your own risk, and the author is not liable for anything that results from using it, including lost work, usage charges or changes to your code.
