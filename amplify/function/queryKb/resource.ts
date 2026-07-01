import { defineFunction } from "@aws-amplify/backend";

// Defines the Lambda that backs the askKb query. entry points at handler.ts
// in the same folder. Imported by amplify/data/resource.ts as the resolver.
export const queryKb = defineFunction({
  name: "queryKb",
  entry: "./handler.ts",
});
