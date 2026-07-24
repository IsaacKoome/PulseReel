# PulseReel Creator Beta

Creator Beta adds a cost-controlled path around the existing movie MVP. It is disabled by default; when disabled, `/create` and the current managed Replicate/local pipeline behave as before.

## What it adds

- A free browser-only story preview. It does not upload media or call Replicate.
- Creator-funded Replicate generation (BYOK). The creator's token exists only in the active request and worker task; it is not written to project storage, job payloads, logs, or browser storage.
- Explicit identity-media consent.
- Private-by-default generated projects, with an opt-in public gallery checkbox.
- Optional beta access codes and a managed-generation daily limit.
- A global generation kill switch that leaves free previews available.
- A protected usage dashboard at `/creator-beta/usage`.

## Safe first rollout

Set these on Vercel, then redeploy:

```dotenv
PULSEREEL_CREATOR_BETA_ENABLED=true
PULSEREEL_CREATOR_DEFAULT_FUNDING=creator-byok
PULSEREEL_CREATOR_MANAGED_GENERATION_ENABLED=false
PULSEREEL_CREATOR_REQUIRE_ACCESS_CODE=true
PULSEREEL_CREATOR_ACCESS_CODES=replace-with-one-or-more-comma-separated-codes
PULSEREEL_CREATOR_BETA_ADMIN_TOKEN=replace-with-a-long-random-secret
PULSEREEL_GENERATION_ENABLED=true
```

Keep `PULSEREEL_REMOTE_MODEL_BACKEND_URL` and its bearer token configured. BYOK still uses the PulseReel worker to prepare and forward the Replicate job, but the Replicate charge goes to the creator's account.

For a very small PulseReel-funded trial, enable managed generation and set a ceiling:

```dotenv
PULSEREEL_CREATOR_MANAGED_GENERATION_ENABLED=true
PULSEREEL_MANAGED_DAILY_LIMIT=3
```

The limit is a simple UTC-day project count, not a transactional billing system. Use it as an MVP guardrail, not as an accounting ledger.

## Selling access without funding generations

Access codes are read from `PULSEREEL_CREATOR_ACCESS_CODES`. A payment page such as Gumroad, Lemon Squeezy, or M-Pesa checkout can deliver a code after purchase. PulseReel does not yet validate licenses against those services automatically. Rotate codes by changing the environment variable and redeploying.

## Cost reporting

Open `/creator-beta/usage` and enter `PULSEREEL_CREATOR_BETA_ADMIN_TOKEN`. The dashboard reports estimated cost exposure using:

- `PULSEREEL_MINIMAX_ESTIMATED_COST_USD`
- `PULSEREEL_KLING_ESTIMATED_COST_USD`

These are estimates only. Replicate's billing records are authoritative, and failed jobs may still incur provider cost.

## Security and privacy boundaries

- Always use HTTPS in production.
- Never ask creators to send API keys by email or chat.
- Do not add request-body logging to `/api/projects` or credential-header logging to the worker.
- Existing legacy projects have no `visibility` field and remain public for backward compatibility.
- Creator Beta projects are private unless the creator opts into the gallery. This is application-level gallery privacy, not per-user authorization: anyone who knows a private watch URL can currently open it.
- Uploaded identity media and job assets are not yet automatically deleted. Before a broad public launch, add authenticated creator accounts, signed watch URLs, a retention policy, and scheduled deletion from Blob/worker storage.

## Rollback

Set `PULSEREEL_CREATOR_BETA_ENABLED=false` and redeploy. This hides all beta controls while preserving the current MVP generation path. Set `PULSEREEL_GENERATION_ENABLED=false` only when all paid generation must stop.
