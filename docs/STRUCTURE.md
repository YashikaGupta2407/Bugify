# Repository structure

Bugify has two clients: the VS Code extension and the React website. Both use
the single Express API in `backend/`. Each application has its own package
manifest, lockfile, and dependencies.

```text
Bugify/
├── extension/
│   ├── src/
│   │   ├── extension.js       # CommonJS activation entry and commands
│   │   ├── api/              # Shared backend client
│   │   ├── context/          # Code context collection and redaction
│   │   ├── diagnostics/      # Diagnostics, local analysis, fix validation
│   │   ├── scanner/          # Project detection, analyzers, parsers
│   │   ├── types/            # JavaScript type documentation
│   │   └── ui/               # Panels, sidebar, status bar, code actions
│   ├── media/                # Extension images and CSS
│   ├── test/                 # Tests and HTML preview harnesses
│   ├── vendor/typescript/    # Bundled compiler and standard libraries
│   ├── .vscode/              # Ignored local extension editor settings
│   ├── .vscodeignore         # Extension packaging exclusions
│   ├── package.json
│   └── README.md             # Extension development and usage
├── website/
│   ├── src/
│   │   ├── main.jsx          # React entry
│   │   ├── App.jsx           # Application component
│   │   └── styles/           # Application CSS
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── backend/                  # API shared by both clients
│   ├── src/
│   │   ├── server.js         # Express entry
│   │   ├── routes/           # HTTP route definitions
│   │   ├── controllers/      # Request handlers
│   │   ├── services/         # Execution, analysis, validation, redaction
│   │   ├── middleware/       # Error and not-found handlers
│   │   └── config/prisma.js  # Shared Prisma client
│   ├── prisma/               # Schema, migrations, seed.js
│   ├── test/
│   ├── .env.example
│   └── package.json
├── docs/                     # Structure guide and existing reports
├── fixtures/
│   ├── test-fixtures/        # Intentional JavaScript, TypeScript, Python errors
│   └── test-workspace/       # Closed-file scanning regression workspace
├── archive/
│   ├── backend/src/services/executionService.js  # Unused mock executor
│   └── scaffolding/          # GSD rules, model registry, VERSION, scripts
├── .vscode/                  # Ignored local launch settings for the repo root
├── .env.example              # Existing root environment template
├── .gitignore
├── docker-compose.yml        # PostgreSQL service and named pgdata volume
└── README.md                 # Existing project overview and setup
```

Fixture contents are deliberately preserved, including broken code. The
extension source and vendored compiler remain together; compiler resolution
order is unchanged. Application logic stays in its existing modules.

## Running each part

Install dependencies with `npm install` from each application's directory.
The commands below assume the existing backend environment and database are
configured. See [the root README](../README.md) and
[the extension README](../extension/README.md) for their existing instructions.
Run the backend and website in separate terminals.

| Working directory | Command | Purpose |
| --- | --- | --- |
| Repository root | `docker compose up -d postgres` | Start the PostgreSQL service |
| `backend/` | `npm run dev` | Start the shared API with Node watch mode |
| `backend/` | `npm start` | Start the shared API without watch mode |
| `backend/` | `npm test` | Run backend tests; endpoint tests need the API and seeded database |
| `website/` | `npm run dev` | Start Vite on its configured port, 5173 |
| `website/` | `npm run build` | Produce the website in `website/dist/` |
| `website/` | `npm run preview` | Preview an existing website build |
| `extension/` | `npm test` | Run the four test files listed in the package script |
| `extension/` | `node --test test/trustworthySuggestions.test.js` | Run the additional extension suite |
| `extension/` | `npm run host` | Launch the macOS VS Code development host with the fixtures |
| `extension/` | `npm run host:antigravity` | Launch the configured macOS Antigravity development host |
| `extension/` | `npm run package` | Build the VSIX using the existing packaging command |

The backend defaults to port 5000 and exposes `/api/health`. Vite forwards
development `/api` requests to `http://127.0.0.1:5000`. The extension's
`bugify.backendUrl` setting defaults to `http://localhost:5000`.

Prisma commands run from `backend/`: the schema is `prisma/schema.prisma`,
migrations are in `prisma/migrations/`, and the configured seed command is
`node prisma/seed.js`. The Compose volume is a named volume, so its location
does not depend on the source directory layout.

Opening the repository root in VS Code exposes its local launch configurations.
Fixture launches point to `fixtures/test-fixtures/`. The existing VSIX command
packages the extension directory; both fixture folders now live outside it.
Archived files are retained for reference, and the mock executor has no runtime
importer in the application source.

## Existing setup issues left unchanged

- `backend/.env.example` uses database password `postgres`, while Compose uses
  `postgrespassword`.
- The root setup guide omits seeding, while controllers require the seeded demo
  user. Existing overview and API examples also contain outdated descriptions.
- Backend endpoint tests expect a running API and seeded database. During
  verification, macOS Control Center occupied port 5000 and returned HTTP 403
  to four tests; the backend health check passed on a temporary port.
- Ignored extension-local editor settings still reference obsolete
  compile/watch scripts and `out/`. The root launcher has no build task.
- Prisma reports the existing `package.json#prisma` configuration as deprecated.
- The macOS host scripts retain their existing absolute application paths.
- The archived GSD validators refer to scaffolding absent from this checkout.

See [the review report](REVIEW_REPORT.md) and
[the JavaScript conversion report](JAVASCRIPT_CONVERSION_REPORT.md) for their
earlier findings. Their findings were retained during the folder moves.
