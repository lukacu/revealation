# Contributing to Revealation

Thanks for helping make Revealation better! Contributions are welcome, especially focused bug fixes, documentation improvements, tests, and self-contained themes or extensions.

## Reporting bugs

Use the **Bug report** issue form. Every report must include:

- The **exact Revealation version** (from About, the hosted `version.json`, or the Git commit), plus OS/browser or desktop environment.
- **Precise steps**, and what happened versus what should have happened.
- A **minimal `.revealation` presentation** that reproduces the issue.

To prepare a reproducer, duplicate the problematic presentation, remove unrelated slides and assets, verify the problem still happens, and export the reduced presentation as `.revealation`. GitHub issue uploads do not accept that extension directly, so place it **inside a `.zip`** and attach the ZIP to the report. Do not just rename the extension; the archive should contain the original `.revealation` file. If uploads are unavailable, provide an accessible link in the issue.

Please remove passwords, API keys, private information, and copyrighted or confidential content before uploading. Screenshots and console errors can help, but do **not** replace the required reproducer. If you cannot share a sanitized reproducible example, first ask for help preparing one without posting private data.

For security vulnerabilities, do **not** create a public issue. Use GitHub's private vulnerability reporting mechanism, if enabled for the repository.

## Suggesting changes

Open a **Feature request** issue. Describe the user problem and desired behavior. Revealation deliberately favors curated themes and a compact UI over arbitrary styling controls; theme/background customization is generally better implemented through extensions.

## Code contributions

1. Discuss substantial changes in an issue first; keep pull requests focused.
2. Work on a branch, follow the surrounding code style, and avoid new dependencies unless justified.
3. Run `./tests/check.sh`, and manually verify affected Edit, Present, and export flows as appropriate.
4. Submit a pull request describing the change, tests, and any compatibility implications for existing decks.

Please keep the Git working tree free of generated build artifacts and unrelated changes.
