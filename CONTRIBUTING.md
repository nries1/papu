# Contributing

All contributions are welcome — bug fixes, new features, hardware support, documentation improvements, and anything in between.

---

## Setup

Follow [SETUP.md](SETUP.md) to get the project running locally. The short version:

```bash
git clone https://github.com/YOUR_USERNAME/home.git
cd home
cp .env.example .env
cp hardware/lib/shared/config.h.example hardware/lib/shared/config.h
npm run up
npm run db:migrate
```

---

## Reporting bugs

Open an issue using the GitHub Issues tab. Include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Relevant logs (`npm run logs`) or error messages

---

## Pull requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Test that the affected service still works (`npm run up`, check the dashboard or API)
4. Open a pull request with a short description of what changed and why

Keep PRs focused — one fix or feature per PR makes review faster. There's no strict style enforcer beyond what's already in the repo; just match the surrounding code.

---

## Questions

Feel free to open a GitHub Discussion or drop a comment on the issue — no question is too small.
