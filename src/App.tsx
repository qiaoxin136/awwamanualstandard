import { useState } from "react";
import { withAuthenticator } from "@aws-amplify/ui-react";
import type { WithAuthenticatorProps } from "@aws-amplify/ui-react";
import { generateClient } from "aws-amplify/api";
import type { Schema } from "../amplify/data/resource";
import type { AskResult } from "./types";
import { SourceCard } from "./components/SourceCard";

const client = generateClient<Schema>({ authMode: "userPool" });

function App({ signOut, user }: WithAuthenticatorProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data, errors } = await client.queries.askKb({ query });
      if (errors && errors.length) {
        setError(errors.map((er) => er.message).join("; "));
      } else if (data) {
        setResult(data as unknown as AskResult);
      }
    } catch (err: any) {
      setError(err?.message ?? "Unexpected error calling the knowledge base.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="app-header">
        <h1>AWWA Standards &amp; Manuals — Knowledge Base</h1>
        <p>
          Ask a question about AWWA water standards. Answers cite the source PDF
          and jump to the exact page. Signed in as{" "}
          <strong>{user?.username ?? user?.signInDetails?.loginId}</strong>.
        </p>
        <button onClick={signOut} style={{ marginTop: 8 }}>
          Sign out
        </button>
      </div>

      <form className="search-bar" onSubmit={ask}>
        <input
          type="text"
          placeholder="e.g. What is the required chlorine contact time for disinfection?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={loading || !query.trim()}>
          {loading ? "Asking…" : "Ask"}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {result && (
        <>
          <div className="section-title">Answer</div>
          <div className="answer">{result.answer}</div>

          {result.sources?.length > 0 && (
            <>
              <div className="section-title">
                Sources ({result.sources.length})
              </div>
              <div className="sources">
                {result.sources.map((s, i) => (
                  <SourceCard key={`${s.s3Key}-${i}`} source={s} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default withAuthenticator(App);
