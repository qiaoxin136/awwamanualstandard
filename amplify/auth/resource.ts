import { defineAuth, secret } from "@aws-amplify/backend";

// Email/password login. Sign-up is enabled so users can self-register;
// remove `userVerification` controls or restrict `access` if you want admin-only sign-up.
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
