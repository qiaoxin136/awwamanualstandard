// Source / AskResult mirror the GraphQL schema in amplify/data/resource.ts.
export type Source = {
  title: string;
  page: number | null;
  s3Key: string;
  presignedUrl: string;
  signedPageUrl: string;
  score: number | null;
};

export type AskResult = {
  answer: string;
  sources: Source[];
};
