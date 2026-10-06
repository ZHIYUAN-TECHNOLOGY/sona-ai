import { phoneNumberClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Clinicians sign in with email and password, patients with a phone code; one client, the Worker's own origin.
export const authClient = createAuthClient({ plugins: [phoneNumberClient()] });
