import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { queryKb } from "./function/queryKb/resource";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";

// `queryKb` is passed to defineBackend both so the data resolver can use it
// (via data/resource.ts) AND so we can reach its CDK Lambda here for grants.
const backend = defineBackend({
  auth,
  data,
  queryKb,
});

// --- Grant the queryKb Lambda access to existing, externally-managed resources --
//
// The KB (VM7DRJONYK) and the PDF bucket (ama-wtrs-assoc-stdns-2020) were
// created outside Amplify. We import them and attach grants to the function's
// Lambda role so it can (a) query Bedrock and (b) read + presign PDFs.
const queryKbLambda = backend.queryKb.resources.lambda;

// 1) Read access to the existing S3 bucket of AWWA PDFs (used for presigning).
const sourceBucket = Bucket.fromBucketName(
  backend.stack,
  "AwwaSourceBucket",
  "ama-wtrs-assoc-stdns-2020"
);
sourceBucket.grantRead(queryKbLambda);

// 2) Permission to call bedrock:Retrieve (the KB) and bedrock:InvokeModel
//    (for Converse with the generation model). Managed KBs do not support
//    RetrieveAndGenerate, so we Retrieve passages then Converse ourselves.
queryKbLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["bedrock:Retrieve"],
    resources: [
      `arn:aws:bedrock:us-east-1:${backend.stack.account}:knowledge-base/VM7DRJONYK`,
    ],
  })
);
queryKbLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["bedrock:InvokeModel"],
    resources: [
      `arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0`,
    ],
  })
);
