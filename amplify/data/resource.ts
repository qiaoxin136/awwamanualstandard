import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { queryKb } from "./../function/queryKb/resource";

// Schema for the askKb query. The response shape mirrors the AskResult/Source
// types returned by the queryKb Lambda so AppSync serializes them cleanly.
const schema = a.schema({
  Source: a.customType({
    title: a.string().required(),
    page: a.integer(),
    s3Key: a.string().required(),
    presignedUrl: a.string().required(),
    signedPageUrl: a.string().required(),
    score: a.float(),
  }),
  AskResult: a.customType({
    answer: a.string().required(),
    sources: a.ref("Source").array(),
  }),
  askKb: a
    .query()
    .arguments({ query: a.string().required() })
    .returns(a.ref("AskResult"))
    // Wire the query directly to the queryKb Lambda function as its resolver.
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(queryKb)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
  // Register the resolver function under a stable key so backend.ts can reach
  // its CDK IFunction via backend.data.resources.functions["queryKb"].
  functions: { queryKb },
});
