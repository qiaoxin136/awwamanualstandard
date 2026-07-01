# AWWA Standards & Manuals — Bedrock Knowledge Base App

An Amplify Gen 2 fullstack React app that queries the AWS Bedrock Knowledge Base
`VM7DRJONYK` ("awwa-standard-and-manual"), shows the generated answer, and lets
the user open each cited source PDF at the exact page.

## What it does
- **Cognito email sign-in** (required) — protects the KB and your PDFs.
- **Ask the KB** — a Lambda behind AppSync runs RAG against the KB:
  1. `Retrieve` (managed search) to get the top-K passages with citations, then
  2. `Converse` with Nova Lite to synthesize a grounded answer.
- **Cited sources** — each citation's S3 URI (+ `_excerpt_page_number` when the
  source PDF has a text layer) becomes a clickable source card.
- **Open the PDF at the page** — two ways per source:
  1. *Open PDF* — new browser tab with a 15-min presigned S3 URL + `#page=N`.
  2. *View inline* — an in-app `react-pdf` viewer that jumps to the cited page.

## Architecture
```
React (Authenticator)  →  AppSync  askKb(query)
                                   → Lambda queryKb
                                       ├─ Bedrock Retrieve  (KB VM7DRJONYK, managedSearchConfiguration)
                                       ├─ Bedrock Converse  (model amazon.nova-lite-v1:0)
                                       └─ S3 presign        (bucket ama-wtrs-assoc-stdns-2020)
```
The Cognito user only calls the GraphQL query; the Lambda (not the browser) holds
all Bedrock + S3 permissions.

### Why Retrieve + Converse (not RetrieveAndGenerate)
KB `VM7DRJONYK` is a **MANAGED** knowledge base. Managed KBs do not support the
`RetrieveAndGenerate` API (`ValidationException: This operation is not supported
for managed knowledge bases`). The equivalent RAG flow is: `Retrieve` the
passages, then `Converse` with the model using those passages as grounding
context. The Lambda does both.

## Local development
```bash
npm install
npx ampx sandbox        # terminal 1 — provisions backend, writes amplify_outputs.json
npm run dev             # terminal 2 — Vite dev server on http://localhost:5173
```
`ampx sandbox` writes `amplify_outputs.json` to the project root, which
`src/main.tsx` imports. Create a Cognito user (via the AWS Console Cognito user
pool, or `aws cognito-idp admin-create-user`), then sign in at
http://localhost:5173.

## Deploy (production)
Connect the repo to **AWS Amplify Hosting** (Gen 2) and let its build run
`npx ampx pipeline-deploy --branch <branch>`, or run it manually:
```bash
npx ampx pipeline-deploy --branch main
```

## Notes & caveats
- The S3 bucket `ama-wtrs-assoc-stdns-2020` (239 AWWA PDFs) and KB `VM7DRJONYK`
  already exist and are **imported** (not created) in `amplify/backend.ts`.
  Amplify will not delete or modify them.
- **Page numbers are per-document.** Bedrock's `_excerpt_page_number` metadata is
  populated only when SMART_PARSING can extract page boundaries — i.e. for PDFs
  with a real text layer (e.g. *Standard Methods for the Examination of Water and
  Wastewater* returns pages 6, 24, 34…). Scanned or image-only PDFs
  (e.g. some M-series manuals like *M20*, *C653-13*) do not expose page numbers.
  For those, the source card shows "Page unknown" and "Open PDF" opens the
  document at page 1. This is a property of the source files, not the app.
- Region: `us-east-1`.
- `pipe.geojson` (unrelated PWCSA sewer GIS data) is left untouched at the root.
