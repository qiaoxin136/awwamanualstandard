import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  type KnowledgeBaseRetrievalResult,
} from "@aws-sdk/client-bedrock-agent-runtime";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// --- Constants for the existing Bedrock Knowledge Base + S3 corpus -----------
// These live outside Amplify (created by hand in the console/CLI). They are
// read by the Lambda at runtime; the bucket/KB are granted to this function's
// role via custom CDK in amplify/backend.ts.
//
// NOTE: KB VM7DRJONYK is a *MANAGED* knowledge base. Managed KBs do NOT support
// RetrieveAndGenerate — that API is for standard KBs. Instead we:
//   1) Retrieve the top-K passages (with managedSearchConfiguration)
//   2) Converse with the model, feeding the passages as grounding context
// This gives us the same answer + cited sources (with page numbers) as RAG.
const KB_ID = "VM7DRJONYK";
const MODEL_ID = "amazon.nova-lite-v1:0";
const SOURCE_BUCKET = "ama-wtrs-assoc-stdns-2020";
const REGION = "us-east-1";
const NUM_RESULTS = 6;

const agentClient = new BedrockAgentRuntimeClient({ region: REGION });
const runtimeClient = new BedrockRuntimeClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

// Presigned URL lifetime. Short enough to be safe, long enough to read a page.
const PRESIGN_SECONDS = 60 * 15;

// --- Public return types (mirror the GraphQL schema in data/resource.ts) -----
export type Source = {
  title: string;
  page: number | null;
  s3Key: string;
  /** Presigned GET URL for the whole PDF (no fragment). */
  presignedUrl: string;
  /** Presigned GET URL + '#page=N' so a browser native viewer jumps to the page. */
  signedPageUrl: string;
  /** Bedrock relevance score (0..1) when available. */
  score: number | null;
};

export type AskResult = {
  answer: string;
  sources: Source[];
};

// --- Helpers -----------------------------------------------------------------

/**
 * Parse an S3 URI of the form
 *   https://ama-wtrs-assoc-stdns-2020.s3.amazonaws.com/Some%20Document.pdf
 * or
 *   s3://ama-wtrs-assoc-stdns-2020/Some%20Document.pdf
 * and return { bucket, key } with the key URL-decoded.
 */
function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  try {
    if (uri.startsWith("s3://")) {
      const withoutScheme = uri.slice("s3://".length);
      const slashIdx = withoutScheme.indexOf("/");
      if (slashIdx === -1) return null;
      return {
        bucket: withoutScheme.slice(0, slashIdx),
        key: decodeURIComponent(withoutScheme.slice(slashIdx + 1)),
      };
    }
    const u = new URL(uri);
    const host = u.host;
    let bucket: string | undefined;
    if (host.startsWith("s3.")) {
      // path-style: s3.amazonaws.com/bucket/key  or  s3.<region>.amazonaws.com/bucket/key
      const parts = u.pathname.replace(/^\//, "").split("/");
      bucket = parts.shift();
      return { bucket: bucket ?? "", key: decodeURIComponent(parts.join("/")) };
    }
    const match = host.match(/^([^\.]+)\.s3[\.a-z-]*amazonaws\.com$/);
    bucket = match ? match[1] : undefined;
    if (!bucket) return null;
    return { bucket, key: decodeURIComponent(u.pathname.replace(/^\//, "")) };
  } catch {
    return null;
  }
}

function pageOf(ref: KnowledgeBaseRetrievalResult): number | null {
  // Bedrock SMART_PARSING populates metadata._excerpt_page_number (a float).
  const meta = (ref.metadata ?? {}) as Record<string, unknown>;
  const raw = meta["_excerpt_page_number"] ?? meta["x-amz-bedrock-page-number"];
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw);
  return null;
}

function titleOf(ref: KnowledgeBaseRetrievalResult): string {
  const meta = (ref.metadata ?? {}) as Record<string, unknown>;
  const t = meta["_document_title"];
  return typeof t === "string" && t.length > 0 ? t : "Untitled document";
}

function s3UriOf(ref: KnowledgeBaseRetrievalResult): string | null {
  const loc = ref.location;
  if (loc?.type === "S3" && loc.s3Location?.uri) return loc.s3Location.uri;
  // Some references expose the URI only in metadata.
  const meta = (ref.metadata ?? {}) as Record<string, unknown>;
  const su = meta["_source_uri"];
  return typeof su === "string" ? su : null;
}

async function presign(bucket: string, key: string): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: PRESIGN_SECONDS }
  );
}

/** Build the grounding context block + source-index map from retrieved results. */
function buildContext(results: KnowledgeBaseRetrievalResult[]): {
  contextText: string;
} {
  if (results.length === 0) return { contextText: "" };
  const lines = results.map((r, i) => {
    const title = titleOf(r);
    const page = pageOf(r);
    const body = (r.content?.text ?? "").trim();
    const cite = page ? `${title} (page ${page})` : title;
    return `[${i + 1}] Source: ${cite}\n${body}`;
  });
  return { contextText: lines.join("\n\n---\n\n") };
}

// --- Handler -----------------------------------------------------------------

type AppSyncEvent<T> = { arguments: T };
type AskArgs = { query: string };

export const handler = async (
  event: AppSyncEvent<AskArgs>
): Promise<AskResult> => {
  const query = (event?.arguments?.query ?? "").trim();
  if (!query) {
    return { answer: "Please enter a question.", sources: [] };
  }

  // 1) Retrieve top-K passages from the managed knowledge base.
  //    Managed KBs require managedSearchConfiguration (NOT vectorSearchConfiguration).
  const retrieveRes = await agentClient.send(
    new RetrieveCommand({
      knowledgeBaseId: KB_ID,
      retrievalQuery: { type: "TEXT", text: query },
      retrievalConfiguration: {
        managedSearchConfiguration: { numberOfResults: NUM_RESULTS },
      },
    })
  );
  const results: KnowledgeBaseRetrievalResult[] =
    retrieveRes.retrievalResults ?? [];

  if (results.length === 0) {
    return {
      answer:
        "I couldn't find any relevant passages in the knowledge base for that question.",
      sources: [],
    };
  }

  // 2) Generate an answer grounded in the retrieved passages via Converse.
  const { contextText } = buildContext(results);
  const systemPrompt = [
    "You are a helpful assistant that answers questions about AWWA water standards and manuals.",
    "Use ONLY the provided context passages to answer. If the context does not contain the answer, say you don't know.",
    "Cite sources using the bracketed numbers [1], [2], etc. that appear in the context.",
    "Be concise and factual.",
  ].join(" ");
  const userMessage = `Context:\n${contextText}\n\nQuestion: ${query}`;

  let answer: string;
  try {
    const converseRes = await runtimeClient.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: systemPrompt }],
        messages: [{ role: "user", content: [{ text: userMessage }] }],
      })
    );
    // Find the first text block in the response.
    const blocks = converseRes.output?.message?.content ?? [];
    answer =
      blocks.map((b) => ("text" in b ? b.text : "")).join("").trim() ||
      "The model did not return an answer.";
  } catch (e) {
    console.warn("Converse failed", e);
    // Fall back to just returning the passages stitched together.
    answer =
      "I retrieved relevant passages but could not generate a summary. " +
      "See the sources below for the relevant text.\n\n" +
      contextText;
  }

  // 3) Build source records, deduping by (s3Key + page) so the same PDF/page
  //    doesn't appear multiple times even when several chunks cite it.
  const dedupe = new Map<string, Source>();
  for (const ref of results) {
    const uri = s3UriOf(ref);
    if (!uri) continue;
    const parsed = parseS3Uri(uri);
    if (!parsed || !parsed.key) continue;
    const page = pageOf(ref);
    const key = `${parsed.bucket}|${parsed.key}|${page ?? "nopage"}`;
    if (dedupe.has(key)) continue;

    let presignedUrl = "";
    try {
      presignedUrl = await presign(parsed.bucket, parsed.key);
    } catch (e) {
      // If presigning fails for one doc, skip it rather than failing the call.
      console.warn("presign failed for", parsed.key, e);
      continue;
    }
    const pageFragment = page ? `#page=${page}` : "";
    dedupe.set(key, {
      title: titleOf(ref),
      page,
      s3Key: parsed.key,
      presignedUrl,
      signedPageUrl: presignedUrl + pageFragment,
      score: typeof ref.score === "number" ? ref.score : null,
    });
  }

  return { answer, sources: Array.from(dedupe.values()) };
};
