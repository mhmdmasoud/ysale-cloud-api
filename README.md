# YSale Cloud API

Standalone Online API for YSale deployments.

## Local development

```bash
npm install
npm run build
npm run dev
```

Health endpoint:

```bash
GET /api/v1/health
```

## Vercel

- Framework Preset: `Other`
- Root Directory: empty / `./`
- Build Command: `npm run build`
- Output Directory: empty

This project uses one Vercel Function only:

- `api/index.ts`

All `/api/*` requests are rewritten to `/api/index`.
